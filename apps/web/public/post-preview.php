<?php
/** Same app shell for people and crawlers, with public metadata in the first response. */
declare(strict_types=1);
// Filled by Vite from the build's public endpoint configuration. No credentials here.
$config = json_decode(base64_decode('__OSP_PREVIEW_CONFIG__'), true);
$site = $config['site'] ?? 'https://opensocial.online';
$api = $config['api'] ?? 'https://api.opensocial.online';

function osp_preview_fetch(string $url): ?array {
    $body = '';
    if (function_exists('curl_init')) {
        $handle = curl_init($url);
        curl_setopt_array($handle, [
            CURLOPT_CONNECTTIMEOUT_MS => 1000, CURLOPT_TIMEOUT_MS => 4000,
            CURLOPT_FOLLOWLOCATION => false, CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2, CURLOPT_HTTPHEADER => ['Accept: application/json'],
            CURLOPT_USERAGENT => 'OpenSocial-LinkPreview/1.0',
            CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk) use (&$body): int {
                if (strlen($body) + strlen($chunk) > 16384) return 0;
                $body .= $chunk;
                return strlen($chunk);
            },
        ]);
        $ok = curl_exec($handle);
        $status = curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        unset($handle);
        if ($ok === false || $status !== 200) return null;
    } else {
        $context = stream_context_create([
            'http' => ['timeout' => 4, 'follow_location' => 0, 'header' => "Accept: application/json\r\nUser-Agent: OpenSocial-LinkPreview/1.0\r\n"],
            'ssl' => ['verify_peer' => true, 'verify_peer_name' => true],
        ]);
        $stream = @fopen($url, 'rb', false, $context);
        if ($stream === false) return null;
        $result = stream_get_contents($stream, 16385);
        $headers = stream_get_meta_data($stream)['wrapper_data'] ?? [];
        fclose($stream);
        if ($result === false || strlen($result) > 16384 || !isset($headers[0]) || !preg_match('~^HTTP/\S+\s+200(?:\s|$)~', $headers[0])) return null;
        $body = $result;
    }
    $data = json_decode($body, true);
    return is_array($data) ? $data : null;
}

function osp_preview_escape(string $text): string {
    return htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

$title = 'Open Social';
$description = 'Your people. Your world. Connect and share on Open Social.';
$canonical = $site . '/';
$image = $site . '/social-card.png';
$imageType = 'image/png';
$imageAlt = 'Open Social — Your people. Your world.';
$public = false;
$id = '';
$path = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH);
if (is_string($path)) $path = rawurldecode($path);
if (is_string($path) && preg_match('~^/post/([A-Za-z0-9_-]{43}=?)/?$~D', $path, $match)) {
    $id = rtrim($match[1], '=') . '=';
    $canonical = $site . '/post/' . rawurlencode($id);
    // The API origin is fixed at build time. Host headers, query strings, cookies,
    // viewers and user-selected URLs cannot change this server-side destination.
    $preview = osp_preview_fetch($api . '/v1/posts/' . rawurlencode($id) . '/preview');
    if (($preview['version'] ?? null) === 1 && ($preview['public'] ?? false) === true &&
        is_string($preview['title'] ?? null) && strlen($preview['title']) <= 1024 &&
        is_string($preview['description'] ?? null) && strlen($preview['description']) <= 2048) {
        $public = true;
        $title = $preview['title'];
        $description = $preview['description'];
        $attachment = $preview['image'] ?? [];
        $expected = '~^/v1/posts/' . preg_quote(rawurlencode($id), '~') . '/preview/image\?version=[A-Za-z0-9_-]{43}=?$~D';
        if (is_string($attachment['path'] ?? null) && preg_match($expected, $attachment['path']) &&
            in_array($attachment['type'] ?? '', ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], true)) {
            $image = $api . $attachment['path'];
            $imageType = $attachment['type'];
            if (is_string($attachment['alt'] ?? null)) $imageAlt = substr($attachment['alt'], 0, 1024);
        }
    }
}

$tags = '<title>' . osp_preview_escape($title) . '</title>' . "\n";
$tags .= '<link rel="canonical" href="' . osp_preview_escape($canonical) . '" data-osp-preview />' . "\n";
$properties = [
    'og:site_name' => 'Open Social', 'og:type' => $public ? 'article' : 'website',
    'og:title' => $title, 'og:description' => $description, 'og:url' => $canonical,
    'og:image' => $image, 'og:image:secure_url' => $image, 'og:image:type' => $imageType,
    'og:image:alt' => $imageAlt,
    'og:image:width' => '1200', 'og:image:height' => '630',
];
foreach ($properties as $property => $value) $tags .= '<meta property="' . $property . '" content="' . osp_preview_escape($value) . '" data-osp-preview />' . "\n";
foreach (['description' => $description, 'twitter:card' => 'summary_large_image', 'twitter:title' => $title, 'twitter:description' => $description, 'twitter:image' => $image, 'twitter:image:alt' => $imageAlt] as $name => $value) {
    $tags .= '<meta name="' . $name . '" content="' . osp_preview_escape($value) . '" data-osp-preview />' . "\n";
}

$html = @file_get_contents(__DIR__ . '/index.html');
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
if ($html === false) {
    http_response_code(503);
    echo 'Open Social is updating. Please try again.';
    exit;
}
echo preg_replace_callback('~<!--osp-social-start-->.*?<!--osp-social-end-->~s', static fn() => "<!--osp-social-start-->\n" . $tags . '<!--osp-social-end-->', $html, 1);
