<?php
/**
 * Plugin Name: Autoblog Bridge
 * Description: Permite que Autoblog (Claude) escriba el título SEO, la meta descripción y la palabra clave de Rank Math o Yoast por la API REST, y guarda las fuentes de cada artículo.
 * Version: 1.0.0
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * License: MIT
 */

if (!defined('ABSPATH')) {
    exit;
}

const AUTOBLOG_BRIDGE_VERSION = '1.0.0';

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

// Ruta mínima para que Autoblog detecte que el plugin está instalado.
add_action('rest_api_init', function () {
    register_rest_route('autoblog/v1', '/status', array(
        'methods'             => 'GET',
        'permission_callback' => '__return_true',
        'callback'            => function () {
            return array(
                'version'  => AUTOBLOG_BRIDGE_VERSION,
                'rankmath' => defined('RANK_MATH_VERSION'),
                'yoast'    => defined('WPSEO_VERSION'),
            );
        },
    ));
});

// Muestra en el editor de qué fuentes salió el artículo y su puntuación de calidad.
add_action('add_meta_boxes', function () {
    add_meta_box('autoblog-sources', 'Autoblog: fuentes', function ($post) {
        $sources = json_decode((string) get_post_meta($post->ID, '_autoblog_sources', true), true);
        $quality = get_post_meta($post->ID, '_autoblog_quality', true);
        if ($quality !== '') {
            echo '<p><strong>Puntuación:</strong> ' . esc_html($quality) . '/10</p>';
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
