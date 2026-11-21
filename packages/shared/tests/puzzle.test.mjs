import test from "node:test";
import assert from "node:assert/strict";
import { TABLE_BOUNDS, puzzleGroupBounds, generateTiles, puzzleSeamPath, PUZZLE_SHAPES, BOARD_WIDTH, BOARD_HEIGHT, slideCollection, PuzzleEngine, isValidPieceCount } from "../dist/index.js";

test("exact counts, full coverage, finite curves, symmetric neighbors and deterministic generation",()=>{
  for(const count of [1,2,7,24,97,997,1000,2999,3000]){
    const tiles=generateTiles(count,42);
    assert.equal(tiles.length,count);
    assert.ok(Math.abs(tiles.reduce((sum,t)=>sum+t.width*t.height,0)-BOARD_WIDTH*BOARD_HEIGHT)<.01);
    for(const tile of tiles){
      assert.ok(tile.width>0&&tile.height>0);
      assert.ok(tile.path.every(c=>c.values.every(Number.isFinite)));
      for(const id of tile.neighbors)assert.ok(tiles[id].neighbors.includes(tile.id));
    }
    assert.deepEqual(generateTiles(count,42),tiles);
  }
  for(const count of [0,-1,3001,NaN,1.5]){assert.equal(isValidPieceCount(count),false);assert.throws(()=>generateTiles(count,42));}
});

test("shared seams have the same cubic geometry in reverse",()=>{
  for(const count of [2,7,97,1000]){
    const tiles=generateTiles(count,17);
    const curves=tiles.flatMap(t=>{let p;return t.path.flatMap(c=>{if(c.op==="M"||c.op==="L"){p=c.values;return [];}if(c.op==="C"){const result=[...p,...c.values];p=c.values.slice(4);return [result];}return [];});});
    const key=curve=>curve.map(n=>n.toFixed(5)).join(",");
    const keys=new Set(curves.map(key));
    for(const curve of curves){
      const reverse=[...curve.slice(6,8),...curve.slice(4,6),...curve.slice(2,4),...curve.slice(0,2)];
      assert.ok(keys.has(key(reverse)),"seam has no matching reverse");
    }
  }
});

test("cut styles differ and preserve the same boundary on both sides of a seam", () => {
  const outlines = new Set();
  for (const shape of PUZZLE_SHAPES) {
    const [left, right] = generateTiles(2, 42, shape);
    // With two horizontal neighbors, the internal seam is the right edge of the first tile.
    const seam = left.path.slice(2, -3);
    const opposite = right.path.slice(4, -1);
    function segments(start, commands) {
      return commands.map(command => {
        const points = [...start, ...command.values];
        start = command.values.slice(-2);
        return points;
      });
    }
    const forward = segments([BOARD_WIDTH / 2, 0], seam);
    const reverse = segments([BOARD_WIDTH / 2, BOARD_HEIGHT], opposite).reverse();
    assert.equal(forward.length, reverse.length);
    forward.forEach((points, index) => {
      const reversedPoints = [];
      const values = reverse[index];
      for (let i = values.length - 2; i >= 0; i -= 2) reversedPoints.push(values[i], values[i + 1]);
      assert.deepEqual(points.map(n => n.toFixed(5)), reversedPoints.map(n => n.toFixed(5)));
    });
    outlines.add(JSON.stringify(forward));
    assert.equal(generateTiles(997, 42, shape).length, 997);
  }
  assert.equal(outlines.size, PUZZLE_SHAPES.length);
  assert.deepEqual(generateTiles(24, 42), generateTiles(24, 42, "classic"));
});

test("preview includes every shared seam once for all cuts and leaves out the board frame", () => {
  for (const shape of PUZZLE_SHAPES) {
    for (const count of [1, 24, 997, 3000]) {
      const tiles = generateTiles(count, 42, shape);
      const neighborLinks = tiles.reduce((total, tile) => total + tile.neighbors.length, 0);
      const seamMoves = puzzleSeamPath(count, 42, shape).match(/M/g) ?? [];
      assert.equal(seamMoves.length, neighborLinks / 2, `${shape}, ${count} pieces`);
    }
  }
});

const engine=(count=4)=>new PuzzleEngine({id:"test",imageId:"quiet-bay",pieceCount:count,seed:42});
test("server ownership, invalid positions, conflicts and disconnection release",()=>{
  const game=engine();
  game.grab("0","alice");
  assert.equal(game.grab("0","bob").groups[0].owner,"alice");
  assert.equal(game.move("0","bob",0,0),null);
  assert.equal(game.release("0","bob",0,0),null);
  assert.equal(game.move("0","alice",Infinity,0),null);
  game.move("0","alice",9000,-9000);
  const bounds = puzzleGroupBounds(game.tiles, [0]);
  assert.equal(game.groups.get("0").dx + bounds.right, TABLE_BOUNDS.right);
  assert.equal(game.groups.get("0").dy + bounds.top, TABLE_BOUNDS.top);
  game.releaseOwner("alice");
  assert.equal(game.groups.get("0").owner,null);
});
test("neighboring pieces merge, locked groups cannot be stolen, placement completes a puzzle",()=>{
  const game=engine();
  const neighbor=game.tiles[0].neighbors[0],id=String(neighbor);
  game.grab(id,"bob");game.move(id,"bob",450,300);
  game.grab("0","alice");
  const blocked=game.release("0","alice",450,300);
  assert.ok(!blocked.removed.includes(id));
  game.releaseOwner("bob");
  game.grab("0","alice");
  const merged=game.release("0","alice",450,300);
  assert.ok(merged.removed.includes(id));
  assert.equal(game.groups.get("0").pieces.length,2);
  game.grab("0", "alice");
  const moved = game.move("0", "alice", 1e8, 1e8).groups[0];
  const bounds = puzzleGroupBounds(game.tiles, moved.pieces);
  assert.equal(moved.dx + bounds.right, TABLE_BOUNDS.right);
  assert.equal(moved.dy + bounds.bottom, TABLE_BOUNDS.bottom);
  for(const group of [...game.groups.values()]){
    if(!game.groups.has(group.id))continue;
    game.grab(group.id,"alice");game.release(group.id,"alice",0,0);
  }
  assert.equal([...game.groups.values()].filter(g=>g.placed).reduce((s,g)=>s+g.pieces.length,0),4);
  const placed=[...game.groups.values()][0];
  assert.equal(game.move(placed.id,"alice",100,100),null);
});
test("canceling a drag restores the starting position without snapping", () => {
  const game = engine(24);
  const original = { ...game.groups.get("0") };
  game.grab("0", "alice");
  game.move("0", "alice", 100, 100);
  assert.equal(game.cancelDrag("0", "bob", 0, 0), null);
  assert.deepEqual(game.cancelDrag("0", "alice", original.dx, original.dy).groups[0], original);
  game.grab("0", "alice");
  const canceled = game.cancelDrag("0", "alice", 0, 0).groups[0];
  assert.equal(canceled.placed, false);
  assert.equal(canceled.owner, null);
});

test("arranging clears overlaps and preserves assembled and held groups", () => {
  const game = engine(24);
  game.grab("0", "alice");
  game.release("0", "alice", 0, 0);
  game.grab("3", "alice");
  for (const id of ["4", "5"]) {
    const tile = game.tiles[Number(id)];
    game.grab(id, "bob");
    game.move(id, "bob", 700 - tile.x, 700 - tile.y);
  }
  game.releaseOwner("bob");

  const bounds = group => {
    const box = puzzleGroupBounds(game.tiles, group.pieces);
    return { left: box.left + group.dx, right: box.right + group.dx,
      top: box.top + group.dy, bottom: box.bottom + group.dy };
  };
  const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const before = game.snapshot();
  assert.ok(overlaps(bounds(before.groups.find(g => g.id === "4")), bounds(before.groups.find(g => g.id === "5"))));
  assert.ok(game.arrange()?.groups.length);
  const after = game.snapshot();
  for (const id of ["0", "3"]) {
    assert.deepEqual(after.groups.find(group => group.id === id), before.groups.find(group => group.id === id));
  }
  const table = after.groups;
  for (const group of table.filter(group => !group.placed && group.owner === null)) {
    const box = bounds(group);
    assert.ok(table.every(other => other.id === group.id || !overlaps(box, bounds(other))));
    assert.ok(box.left >= TABLE_BOUNDS.left && box.right <= TABLE_BOUNDS.right);
    assert.ok(box.top >= TABLE_BOUNDS.top && box.bottom <= TABLE_BOUNDS.bottom);
  }
  const saved = game.saveSnapshot();
  const restored = new PuzzleEngine(saved.definition, saved.groups, saved.arrangeHistory);
  assert.ok(restored.undoArrange()?.groups.length);
  assert.deepEqual(restored.snapshot().groups.map(({dx, dy}) => ({dx, dy})),
    before.groups.map(({dx, dy}) => ({dx, dy})));
});

test("a full 3000-piece collection moves together and survives storage and restore", () => {
  const game = engine(3000), ids = [...game.groups.keys()];
  game.grab(ids[0], "guest", true);
  game.grab(ids[1], "guest", true);
  assert.equal(game.collect(ids, "store", 0, 0), null);
  assert.equal(game.releaseOwner("guest").groups.length, 2);
  const before = game.snapshot().groups;
  const moved = game.collect(ids, "move", 1e5, -1e5);
  const dx = moved.groups[0].dx - before[0].dx, dy = moved.groups[0].dy - before[0].dy;
  assert.ok(moved.groups.every((g,i) => Math.abs(g.dx-before[i].dx-dx)<1e-7 && Math.abs(g.dy-before[i].dy-dy)<1e-7));
  assert.equal(game.collect(ids, "store", 0, 0).groups.length, 3000);
  const saved = game.saveSnapshot(), restored = new PuzzleEngine(saved.definition, saved.groups);
  assert.equal(restored.arrange(), null);
  assert.equal(restored.collect(ids, "restore", 0, 0).groups.length, 3000);
});

test("expanded margins allow movement and survive restore; shrinking brings pieces inside", () => {
  const game = engine(24);
  assert.equal(game.resizeField(2).fieldSize,2);
  game.collect(["0","1"],"move",20000,0);
  const saved = game.saveSnapshot();
  const restored = new PuzzleEngine(saved.definition,saved.groups,saved.arrangeHistory,saved.fieldSize);
  assert.deepEqual(restored.snapshot(),game.snapshot());
  const right = g => puzzleGroupBounds(restored.tiles,g.pieces).right + g.dx;
  assert.ok(Math.max(...[...restored.groups.values()].map(right)) > TABLE_BOUNDS.right);
  const change = restored.resizeField(1);
  assert.ok(change.groups.length);
  assert.ok([...restored.groups.values()].every(g=>right(g)<=TABLE_BOUNDS.right+1e-7));
});

test("single piece can complete; snapshots cannot mutate the engine",()=>{
  const game=engine(1),snapshot=game.snapshot();
  snapshot.groups[0].pieces.push(5);
  assert.equal(game.groups.get("0").pieces.length,1);
  game.grab("0","alice");game.release("0","alice",0,0);
  assert.equal(game.groups.get("0").placed,true);
});

test("collection physics separates overlapping groups along each wall", () => {
  const table = { left: 0, top: 0, right: 200, bottom: 200 };
  const bounds = { left: 0, top: 0, right: 20, bottom: 20 };
  const groups = [{ id:"a", dx:40, dy:40, bounds }, { id:"b", dx:45, dy:45, bounds }];
  assert.deepEqual(slideCollection(groups, 2, 3, table), [
    { id:"a", dx:42, dy:43 }, { id:"b", dx:47, dy:48 },
  ]);
  for (const [x, y, wall] of [[-300,0,0], [300,0,180], [0,-300,0], [0,300,180]]) {
    const [a, b] = slideCollection(groups, x, y, table);
    const normal = x ? "dx" : "dy", tangent = x ? "dy" : "dx";
    assert.equal(a[normal], wall);
    assert.equal(b[normal], wall);
    assert.ok(Math.abs(a[tangent] - b[tangent]) >= 20);
    assert.ok(b[tangent] >= 0 && b[tangent] <= 180);
  }
});
