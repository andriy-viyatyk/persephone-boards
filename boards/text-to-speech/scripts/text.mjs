export function splitSentences(text) {
  const sentences = text.replace(/\s+/g, " ").match(/[^.!?…]+[.!?…]*["»”)]*\s*|[.!?…]+/gu) || [];
  const result = [];
  for (const raw of sentences) {
    let sentence = raw.trim();
    while (sentence.length > 220) {
      const cut = sentence.lastIndexOf(",", 220);
      if (cut < 20) break;
      result.push(sentence.slice(0, cut + 1).trim());
      sentence = sentence.slice(cut + 1).trim();
    }
    if (/[\p{L}\p{N}]/u.test(sentence)) result.push(sentence);
  }
  return result;
}
