import test from "node:test";
import assert from "node:assert/strict";
import {detailResolution,cropResolution,intersectBounds,bufferedCrop,containsBounds} from "../src/features/puzzle/rendering/detailPolicy.ts";
import {watchDisplayDensity} from "../src/features/puzzle/rendering/displayDensity.ts";

test("both distant and close pieces rasterize with two samples per physical screen pixel",()=>{
  for(const density of [1,1.25,1.5,2,3])for(const zoom of [.08,.33,.6,1,1.01,1.25,2,2.01,3.7,6]){
    const ratio=detailResolution(zoom,density);
    assert.ok(ratio>=2*zoom*density);
    assert.ok(ratio<2*zoom*density+.125001);
  }
});
test("a single large piece uses a viewport crop, not a full image at maximum resolution",()=>{
  const piece={x:-1,y:-1,width:1602,height:1002};
  for(const zoom of [.6,1.25,2.01,6])for(const density of [1,2]){
    const view={x:600,y:300,width:1000/zoom,height:720/zoom};
    const visible=intersectBounds(piece,view);
    const desired=detailResolution(zoom,density);
    const crop=bufferedCrop(visible,piece,zoom,desired);
    const resolution=cropResolution(crop,desired);
    assert.ok(containsBounds(crop,visible));
    assert.ok(containsBounds(piece,crop));
    assert.ok(Math.ceil(crop.width*resolution)<=4096);
    assert.ok(Math.ceil(crop.height*resolution)<=4096);
  }
});
test("a large crop reduces oversampling instead of falling back to a magnified atlas",()=>{
  const crop={x:0,y:0,width:2100,height:1400};
  const resolution=cropResolution(crop,4);
  assert.ok(resolution>1);
  assert.ok(Math.ceil(crop.width*resolution)<=4096);
  assert.ok(Math.ceil(crop.height*resolution)<=4096);
});
test("monitor density changes re-arm the listener and cleanup removes it",()=>{
  let density=1,changes=0;
  const queries=[];
  const stop=watchDisplayDensity(()=>changes++,()=>density,value=>{
    const listeners=new Set();
    const query={value,listeners,addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn)};
    queries.push(query);return query;
  });
  for(const next of [1.25,2,1]){
    const previous=queries.at(-1);
    density=next;for(const listener of [...previous.listeners])listener();
    assert.equal(previous.listeners.size,0);
    assert.equal(queries.at(-1).value,`(resolution: ${next}dppx)`);
  }
  assert.equal(changes,3);stop();assert.equal(queries.at(-1).listeners.size,0);
});
test("panning checks crop coverage and never cuts off a visible part",()=>{
  const piece={x:0,y:0,width:1600,height:1000};
  const first={x:600,y:300,width:160,height:120};
  const old=bufferedCrop(first,piece,6,12);
  const next={...first,x:900};
  assert.equal(containsBounds(old,next),false);
  assert.ok(containsBounds(bufferedCrop(next,piece,6,12),next));
  assert.equal(intersectBounds(piece,{x:2000,y:2000,width:10,height:10}),null);
});
