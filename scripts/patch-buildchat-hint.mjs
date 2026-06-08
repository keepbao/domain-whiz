import fs from "node:fs";

const p = "apps/desktop/src/renderer/src/BuildChat.tsx";
let s = fs.readFileSync(p, "utf8");
const lines = [
  "\u68c0\u6d4b\u5230\u98de\u4e66\u5ba1\u6279\u5173\u952e\u5b57\uff1a",
  "\u00b7 \u5728\u5bf9\u8bdd\u6846\u91cc\u8f93\u5165\u300c<\u57df\u540d1> <\u57df\u540d2> \u57df\u540d\u8d2d\u4e70\u300d\u6216\u300c<\u57df\u540d> \u57df\u540d\u89e3\u6790\u300d\u5373\u53ef\u5f39\u51fa\u5ba1\u6279\u5361\u7247\uff1b",
  "\u00b7 \u5361\u7247\u4f1a\u9884\u586b\u57df\u540d\uff0c\u4f60\u8865\u5145\u57df\u540d\u8d1f\u8d23\u4eba user_id / \u89e3\u6790\u5730\u5740 / \u9700\u6c42\u539f\u56e0\u7b49\u5b57\u6bb5\uff0c\u70b9\u300c\u786e\u8ba4\u63d0\u4ea4\u5230\u98de\u4e66\u5ba1\u6279\u300d\uff1b",
  "\u00b7 \u63d0\u4ea4\u540e\u5361\u7247\u4f1a\u6309 60 \u79d2\u4e00\u6b21\u7684\u8f6e\u8be2\u81ea\u52a8\u5237\u65b0\u53f3\u4e0a\u89d2\u72b6\u6001\uff1bAPPROVED \u540e\u7533\u8bf7\u4eba\u4f1a\u6536\u5230\u98de\u4e66\u79c1\u4fe1\u901a\u77e5\u3002",
];
const block =
  "const APPROVAL_HINT_BUBBLE = [\n" +
  lines.map((l) => `  ${JSON.stringify(l)},`).join("\n") +
  '\n].join("\\n");';
s = s.replace(/const APPROVAL_HINT_BUBBLE = \[[\s\S]*?\]\.join\("\\n"\);/, block);
if (!s.includes("域名负责人 user_id")) {
  throw new Error("APPROVAL_HINT_BUBBLE patch failed");
}
fs.writeFileSync(p, s, "utf8");
