/**
 * Manual test examples for decodeHtmlEntities.
 * Run with: npx tsx src/decodeHtmlEntities.test.ts
 */
import { decode as decodeEntities } from "html-entities";

function decodeHtmlEntities(text: string | null | undefined): string {
  if (!text) return text ?? "";
  try {
    return decodeEntities(text);
  } catch {
    return text;
  }
}

const cases: Array<{ input: string | null | undefined; expected: string }> = [
  // 요구사항 최소 항목
  { input: "&#x27;식이섬유&#x27;", expected: "'식이섬유'" },
  { input: "&quot;인용구&quot;", expected: '"인용구"' },
  { input: "AT&amp;T", expected: "AT&T" },
  { input: "1 &lt; 2 &gt; 0", expected: "1 < 2 > 0" },
  // 실제 발생 사례 (한겨레)
  {
    input: "낮에 먹은 &#x27;식이섬유&#x27;가 오늘밤 숙면을 좌우한다",
    expected: "낮에 먹은 '식이섬유'가 오늘밤 숙면을 좌우한다",
  },
  // 10진수 엔티티
  { input: "&#39;single&#39;", expected: "'single'" },
  // named entity (기본 테이블 외)
  { input: "em&mdash;dash", expected: "em\u2014dash" },
  // null / undefined 안전 처리
  { input: null, expected: "" },
  { input: undefined, expected: "" },
  // 엔티티 없는 일반 텍스트는 그대로
  { input: "no entities here", expected: "no entities here" },
];

let passed = 0;
let failed = 0;

for (const { input, expected } of cases) {
  const result = decodeHtmlEntities(input);
  if (result === expected) {
    console.log(`PASS  input=${JSON.stringify(input)}`);
    passed++;
  } else {
    console.error(`FAIL  input=${JSON.stringify(input)}`);
    console.error(`      expected=${JSON.stringify(expected)}`);
    console.error(`      got     =${JSON.stringify(result)}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
