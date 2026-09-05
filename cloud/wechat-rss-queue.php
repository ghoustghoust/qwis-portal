<?php
// 公众号文章队列端点（T34 / F43）：仅接受公众号文章链接（mp.weixin.qq.com）
require __DIR__ . '/_queue_lib.php';

$QUEUE = 'wechat';

queue_require_token();

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true);
    if (!is_array($body) || empty($body['url'])) queue_json(array('ok' => false, 'error' => 'missing url'), 400);
    $url = trim(strval($body['url']));
    // type 校验：仅公众号文章链接
    if (strpos($url, 'mp.weixin.qq.com') === false) {
        queue_json(array('ok' => false, 'error' => '仅接受公众号文章链接（mp.weixin.qq.com）'), 400);
    }
    $item = array(
        'url'  => $url,
        'name' => isset($body['name']) ? trim(strval($body['name'])) : '',
        'type' => $QUEUE,
        'ts'   => date('c'),
    );
    if (!queue_push($QUEUE, $item)) queue_json(array('ok' => false, 'error' => 'write failed'), 500);
    queue_json(array('ok' => true));
}

$action = isset($_GET['action']) ? $_GET['action'] : 'pull';
if ($action === 'pull') {
    $items = queue_pull($QUEUE);
    queue_json(array('ok' => true, 'count' => count($items), 'items' => $items));
}
if ($action === 'clear') {
    queue_clear($QUEUE);
    queue_json(array('ok' => true));
}
queue_json(array('ok' => false, 'error' => 'unknown action'), 400);
