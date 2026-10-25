<?php
/**
 * Plugin Name: Autoblog Bridge
 * Description: Conecta Autoblog (Claude) con WordPress: SEO de Rank Math o Yoast por la API REST, fuentes de cada artículo, bloqueo entre ejecuciones, estado compartido, avisos por correo e imágenes en WebP.
 * Version: 1.1.0
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * License: MIT
 */

if (!defined('ABSPATH')) {
    exit;
}

const AUTOBLOG_BRIDGE_VERSION = '1.1.0';
const AUTOBLOG_STATE_MAX_BYTES = 1048576;

function autoblog_bridge_meta_keys() {
    return array(
        // Rank Math
        'rank_math_title',
        'rank_math_description',
        'rank_math_focus_keyword',
        // Yoast SEO
        '_yoast_wpseo_title',
        '_yoast_wpseo_metadesc',
        '_yoast_wpseo_focuskw',
        // Autoblog
        '_autoblog_sources',
        '_autoblog_quality',
        '_autoblog_refreshed_at',
    );
}

add_action('init', function () {
    foreach (autoblog_bridge_meta_keys() as $key) {
        register_post_meta('post', $key, array(
            'type'          => 'string',
            'single'        => true,
            'show_in_rest'  => true,
            'auth_callback' => function ($allowed, $meta_key, $post_id) {
                return current_user_can('edit_post', $post_id);
            },
        ));
    }
});

function autoblog_bridge_can_write() {
    return current_user_can('edit_posts');
}

add_action('rest_api_init', function () {
    // Estado: permite a Autoblog saber que el plugin está instalado y qué versión tiene.
    register_rest_route('autoblog/v1', '/status', array(
        'methods'             => 'GET',
        'permission_callback' => '__return_true',
        'callback'            => function () {
            return array(
                'version'  => AUTOBLOG_BRIDGE_VERSION,
                'features' => array('lock', 'state', 'notify', 'webp'),
                'rankmath' => defined('RANK_MATH_VERSION'),
                'yoast'    => defined('WPSEO_VERSION'),
                'webp'     => autoblog_bridge_webp_supported(),
            );
        },
    ));

    // Bloqueo compartido: evita que dos ejecuciones (p. ej. el PC y la nube) publiquen a la vez.
    register_rest_route('autoblog/v1', '/lock', array(
        array(
            'methods'             => 'POST',
            'permission_callback' => 'autoblog_bridge_can_write',
            'callback'            => function (WP_REST_Request $req) {
                $run = sanitize_text_field((string) $req->get_param('run_id'));
                $ttl = max(60, min(14400, (int) ($req->get_param('ttl') ?: 7200)));
                if ($run === '') {
                    return new WP_Error('autoblog_bad_request', 'Falta run_id', array('status' => 400));
                }
                $value = wp_json_encode(array('run_id' => $run, 'expires' => time() + $ttl));
                // add_option es atómico: falla si la opción ya existe.
                if (add_option('autoblog_lock', $value, '', 'no')) {
                    return array('ok' => true, 'run_id' => $run);
                }
                $current = json_decode((string) get_option('autoblog_lock'), true);
                if (!is_array($current) || (int) $current['expires'] < time()) {
                    delete_option('autoblog_lock');
                    if (add_option('autoblog_lock', $value, '', 'no')) {
                        return array('ok' => true, 'run_id' => $run, 'replaced_expired' => true);
                    }
                    $current = json_decode((string) get_option('autoblog_lock'), true);
                }
                return array('ok' => false, 'held_by' => $current['run_id'] ?? null, 'expires' => $current['expires'] ?? null);
            },
        ),
        array(
            'methods'             => 'DELETE',
            'permission_callback' => 'autoblog_bridge_can_write',
            'callback'            => function (WP_REST_Request $req) {
                $run = sanitize_text_field((string) $req->get_param('run_id'));
                $current = json_decode((string) get_option('autoblog_lock'), true);
                if (is_array($current) && $current['run_id'] === $run) {
                    delete_option('autoblog_lock');
                    return array('ok' => true);
                }
                return array('ok' => false);
            },
        ),
    ));

    // Estado compartido (cola de temas, historial): permite que la nube y el PC compartan datos.
    register_rest_route('autoblog/v1', '/state/(?P<key>[a-z0-9_-]{1,40})', array(
        array(
            'methods'             => 'GET',
            'permission_callback' => 'autoblog_bridge_can_write',
            'callback'            => function (WP_REST_Request $req) {
                $raw = get_option('autoblog_state_' . $req['key'], null);
                return array('key' => $req['key'], 'value' => $raw === null ? null : json_decode((string) $raw, true));
            },
        ),
        array(
            'methods'             => 'POST',
            'permission_callback' => 'autoblog_bridge_can_write',
            'callback'            => function (WP_REST_Request $req) {
                $json = wp_json_encode($req->get_param('value'));
                if ($json === false || strlen($json) > AUTOBLOG_STATE_MAX_BYTES) {
                    return new WP_Error('autoblog_too_large', 'Estado demasiado grande', array('status' => 413));
                }
                update_option('autoblog_state_' . $req['key'], $json, 'no');
                return array('ok' => true, 'bytes' => strlen($json));
            },
        ),
    ));

    // Avisos por correo con el correo del propio WordPress.
    register_rest_route('autoblog/v1', '/notify', array(
        'methods'             => 'POST',
        'permission_callback' => 'autoblog_bridge_can_write',
        'callback'            => function (WP_REST_Request $req) {
            $to = sanitize_email((string) $req->get_param('to'));
            if ($to === '' || !is_email($to)) {
                $to = get_option('admin_email');
            }
            $subject = sanitize_text_field((string) $req->get_param('subject'));
            $body = wp_kses_post((string) $req->get_param('body'));
            $sent = wp_mail($to, $subject ?: 'Autoblog', $body, array('Content-Type: text/html; charset=UTF-8'));
            return array('ok' => (bool) $sent, 'to' => $to);
        },
    ));
});

// Imágenes más livianas: los tamaños que genera WordPress se guardan en WebP.
function autoblog_bridge_webp_supported() {
    return function_exists('wp_image_editor_supports') && wp_image_editor_supports(array('mime_type' => 'image/webp'));
}

add_filter('image_editor_output_format', function ($formats) {
    if (apply_filters('autoblog_bridge_webp', true) && autoblog_bridge_webp_supported()) {
        $formats['image/jpeg'] = 'image/webp';
        $formats['image/png'] = 'image/webp';
    }
    return $formats;
});

// Muestra en el editor de qué fuentes salió el artículo y su puntuación de calidad.
add_action('add_meta_boxes', function () {
    add_meta_box('autoblog-sources', 'Autoblog: fuentes', function ($post) {
        $sources = json_decode((string) get_post_meta($post->ID, '_autoblog_sources', true), true);
        $quality = get_post_meta($post->ID, '_autoblog_quality', true);
        $refreshed = get_post_meta($post->ID, '_autoblog_refreshed_at', true);
        if ($quality !== '') {
            echo '<p><strong>Puntuación:</strong> ' . esc_html($quality) . '/10</p>';
        }
        if ($refreshed !== '') {
            echo '<p><strong>Actualizado por Autoblog:</strong> ' . esc_html($refreshed) . '</p>';
        }
        if (empty($sources) || !is_array($sources)) {
            echo '<p>Sin fuentes registradas.</p>';
            return;
        }
        echo '<ol>';
        foreach ($sources as $s) {
            $url = isset($s['url']) ? $s['url'] : '';
            $title = isset($s['title']) ? $s['title'] : $url;
            echo '<li><a href="' . esc_url($url) . '" target="_blank" rel="noopener">' . esc_html($title) . '</a></li>';
        }
        echo '</ol>';
    }, 'post', 'side');
});
