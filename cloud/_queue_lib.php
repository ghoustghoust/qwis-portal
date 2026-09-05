<?php
// 云端队列公共库（T33 / F43 / N3）
// Token 校验（token.json 与 setup 生成的 API_TOKEN 一致）+ JSON 文件存储（flock 读写锁防并发损坏）

define('QUEUE_DIR', __DIR__);

// 从同目录 token.json 读期望 Token
function queue_token_expected() {
    $f = QUEUE_DIR . '/token.json';
    if (!file_exists($f)) return null;
    $j = json_decode(file_get_contents($f), true);
    return (is_array($j) && isset($j['token'])) ? $j['token'] : null;
}

// Token 校验：?token= 或 POST body.token；不一致返回 403 {"ok":false,"error":"bad token"}
function queue_require_token() {
    $expected = queue_token_expected();
    $given = isset($_GET['token']) ? $_GET['token'] : null;
    if ($given === null) {
        $raw = file_get_contents('php://input');
        $body = json_decode($raw, true);
        if (is_array($body) && isset($body['token'])) $given = $body['token'];
    }
    if (!$expected || !is_string($given) || !hash_equals($expected, $given)) {
        queue_json(array('ok' => false, 'error' => 'bad token'), 403);
    }
}

function queue_file($name) {
    // 队列名仅允许字母数字与连字符，防路径穿越
    $safe = preg_replace('/[^a-z0-9\-]/i', '', $name);
    return QUEUE_DIR . '/' . $safe . '-queue.json';
}

// push：读-改-写全程持独占锁
function queue_push($name, $item) {
    $fp = fopen(queue_file($name), 'c+');
    if (!$fp) return false;
    flock($fp, LOCK_EX);
    $raw = stream_get_contents($fp);
    $items = json_decode($raw, true);
    if (!is_array($items)) $items = array();
    $items[] = $item;
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($items, JSON_UNESCAPED_UNICODE));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    return true;
}

// pull：共享锁读取，返回数组
function queue_pull($name) {
    $f = queue_file($name);
    if (!file_exists($f)) return array();
    $fp = fopen($f, 'r');
    if (!$fp) return array();
    flock($fp, LOCK_SH);
    $raw = stream_get_contents($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    $items = json_decode($raw, true);
    return is_array($items) ? $items : array();
}

// clear：独占锁清空
function queue_clear($name) {
    $fp = fopen(queue_file($name), 'c+');
    if (!$fp) return false;
    flock($fp, LOCK_EX);
    ftruncate($fp, 0);
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    return true;
}

// 统一 JSON 输出并结束
function queue_json($arr, $code = 200) {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($arr, JSON_UNESCAPED_UNICODE);
    exit;
}
