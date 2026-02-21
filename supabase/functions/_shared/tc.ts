// Shared helpers for edge functions (Deno)

export function extractTermsBlock(text: string) {
  const t = String(text ?? "");
  const start = t.search(/\n\s*📌\s*Termos\s+e\s+Condições\s*:/i);
  if (start === -1) return null;

  const afterStart = t.slice(start + 1);
  // Ends before a blank line + next section marker (emoji + word) or end of chunk.
  // We keep it simple: end at the next double newline that is followed by an emoji marker or a day marker.
  const endRel = afterStart.search(/\n\n(?=\s*(?:📅|🔹|🔸|📧|🔔|💬|👉|⏰|✅|\[|$))/);
  const end = endRel === -1 ? t.length : start + 1 + endRel;

  const block = t.slice(start + 1, end).trimEnd();
  return { start: start + 1, end, block };
}

export function replaceTermsBlock(text: string, block: string) {
  const found = extractTermsBlock(text);
  if (!found) return text;
  return (text.slice(0, found.start) + block.trimEnd() + text.slice(found.end)).trim();
}
