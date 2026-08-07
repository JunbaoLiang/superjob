export function applyOutreachEdit(existing, input, now = new Date().toISOString()) {
  if (!existing || typeof existing !== "object") throw new Error("尚未生成外联草稿");
  const note = typeof input?.note === "string" ? input.note.trim() : "";
  const message = typeof input?.message === "string" ? input.message.trim() : "";
  if (!note || !message) throw new Error("外联备注和消息都不能为空");
  if (note.length > 200) throw new Error("连接备注不能超过 200 字符");
  return { ...existing, note, message, edited_at: now };
}
