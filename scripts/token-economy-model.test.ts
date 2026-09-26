import test from "node:test";
import assert from "node:assert/strict";
const score = (up: bigint, down: bigint) => { const n = up > down ? up - down : 0n; return 1000n*n*n/(n+1n); };
const allocate = (votes: Array<[bigint,bigint]>, budget=100n) => {
  const scores=votes.map(([u,d])=>score(u,d)),total=scores.reduce((a,b)=>a+b,0n);
  return scores.map(s=>total ? budget*s/total : 0n);
};
test("allocation conserves capped issuance and is invariant to claim order across adversarial samples",()=>{
  let seed=42;
  const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  for(let n=0;n<10000;n++){
    const votes=Array.from({length:1+rand()%30},()=>[BigInt(rand()%1000),BigInt(rand()%1000)] as [bigint,bigint]);
    const results=allocate(votes);
    assert.ok(results.reduce((a,b)=>a+b,0n)<=100n);
    votes.forEach(([u,d],i)=>{if(d>=u)assert.equal(results[i],0n);});
    assert.deepEqual(allocate([...votes].reverse()).reverse(),results);
  }
});
test("convergence does not claim to cure collusion, concentration or sparse participation",()=>{
  assert.deepEqual(allocate([[1n,0n]]),[100n]); // One positive contribution receives the whole shared pool.
  assert.deepEqual(allocate([[0n,0n],[0n,0n]]),[0n,0n]); // Free accounts have no paid influence.
  assert.deepEqual(allocate([[100n,100n],[1n,0n]]),[0n,100n]); // Contest can redirect the pool.
  assert.ok(score(100n,0n)>100n*score(1n,0n)); // Splitting weakens score; it does not prove unique people.
  assert.ok(allocate([[1000n,0n],[1n,0n]])[0]!>=99n); // Concentration remains possible.
  assert.ok(score(1000000n,0n)*100n < 2n**64n);
});
