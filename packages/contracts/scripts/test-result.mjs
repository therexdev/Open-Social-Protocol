/** as-pect 8 prints failed assertions without necessarily setting a nonzero exit code. */
export function contractTestsPassed(status, output) {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, "");
  const counts = [...clean.matchAll(/\[Tests\]:\s*(\d+)\s*\/\s*(\d+)/g)];
  const results = [...clean.matchAll(/\[Result\]:([^\n]*)/g)];
  return status === 0 && counts.length > 0 && results.length > 0 &&
    counts.every(m => Number(m[1]) > 0 && m[1] === m[2]) &&
    results.every(m => /✔ Pass!/.test(m[1]));
}
