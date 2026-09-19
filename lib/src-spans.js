// 顶层函数切分 —— 文本型锁（tests I10 / whitebox W14）的唯一实现。
// 为什么单独成文件：本轮两类假结果都出在"自己手写函数边界"上——
//  ① 拿"第一个行首 }"当右边界，被函数内的 catch/循环闭合括号截断 → 把自己的合法 SQL 判成逃逸（假红）；
//  ② 用 replace('{\n') 注入探针样本，而仓库源码是 CRLF，模式永不命中 → "注入未生效"被读成"锁没拦住"（假绿，坑 #57）。
// 所以边界只由"下一个顶层声明"决定，且一切按 /\r?\n/ 分行，不假设行尾风格。
const DECL_RE = /^(?:async )?function (\w+)\(/gm;

// 整行注释要剥掉：注释里写"某查询已移出本函数"是必要说明，不能参与判据。
const stripCommentLines = (text) => text.split(/\r?\n/)
  .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');

// → [{ name, start, end, body }]，按声明顺序；最后一个函数的 end 是文件尾
function spans(src) {
  const decls = [...src.matchAll(DECL_RE)];
  return decls.map((d, i) => ({
    name: d[1],
    start: d.index,
    end: i + 1 < decls.length ? decls[i + 1].index : src.length,
    body: stripCommentLines(src.slice(d.index, i + 1 < decls.length ? decls[i + 1].index : src.length)),
  }));
}

// 偏移量落在哪个顶层函数里（不在任何函数内 → null）
function ownerAt(src, offset) {
  const list = spans(src);
  const hit = list.find((f) => offset >= f.start && offset < f.end);
  return hit ? hit.name : null;
}

module.exports = { spans, ownerAt };
