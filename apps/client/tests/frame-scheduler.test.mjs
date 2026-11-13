import test from "node:test";
import assert from "node:assert/strict";
import { FrameScheduler } from "../src/features/puzzle/rendering/FrameScheduler.ts";

function fixture(draw){
  let id=0;
  const pending=new Map();
  const scheduler=new FrameScheduler(draw,callback=>{pending.set(++id,callback);return id;},id=>pending.delete(id));
  function tick(){const work=[...pending.values()];pending.clear();for(const callback of work)callback(0);}
  return {scheduler,pending,tick};
}
test("many pointer/network updates draw once, then an idle puzzle draws no frames",()=>{
  let draws=0;const f=fixture(()=>draws++);
  for(let i=0;i<3000;i++)f.scheduler.request();
  assert.equal(f.pending.size,1);f.tick();assert.equal(draws,1);
  for(let i=0;i<120;i++)f.tick();
  assert.equal(draws,1);assert.equal(f.pending.size,0);
  f.scheduler.request();f.tick();assert.equal(draws,2);
});
test("a change during rendering is preserved for the next frame",()=>{
  let draws=0;const f=fixture(()=>{if(++draws===1)f.scheduler.request();});
  f.scheduler.request();f.tick();assert.equal(f.pending.size,1);
  f.tick();assert.equal(draws,2);assert.equal(f.pending.size,0);
});
test("disposing cancels pending rendering and late callbacks cannot touch a destroyed renderer",()=>{
  let draws=0;const f=fixture(()=>draws++);
  f.scheduler.request();const late=[...f.pending.values()][0];
  f.scheduler.dispose();assert.equal(f.pending.size,0);
  late(0);f.scheduler.request();f.tick();
  assert.equal(draws,0);assert.equal(f.pending.size,0);
});
