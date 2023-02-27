const getStoredProceduresName = (storedP) => {
  const pattern1 = /CREATE\s+PROCEDURE\s+(\w+)/i;
  const pattern2 = /CREATE\s+PROCEDURE\s+\[dbo\]\.\[(\w+)\]/i;

  const match1 = storedP.match(pattern1) || storedP.match(pattern2) || [];

  return match1[1] || null;
};

const parsed = (stored) => {
  const parsedSP = stored
    .replace(/\s(?=\S)/g, "Ω")
    .replace(/\s+/g, "")
    .replace(/\Ω/g, " ");

  const name = getStoredProceduresName(parsedSP);

  return {
    name,
    raw: stored,
    noWhite: parsedSP.replace(/\s+/g, ""),
  };
};

module.exports = parsed;
