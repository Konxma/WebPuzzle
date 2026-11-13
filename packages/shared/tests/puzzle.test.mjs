import test from "node:test";
import assert from "node:assert/strict";
import { TABLE_BOUNDS, MAX_PUZZLE_TRAYS, puzzleGroupBounds, generateTiles, puzzleSeamPath, PUZZLE_SHAPES, BOARD_WIDTH, BOARD_HEIGHT, PuzzleEngine, isValidPieceCount } from "../dist/index.js";

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
test("new rooms start without trays, and old occupied trays and outlying groups are restored", () => {
  const game = engine();
  assert.deepEqual(game.snapshot().trays, []);
  game.grab("0", "alice");
  assert.equal(game.stash("0", "alice", "tray-1", 0, 0), null);
  assert.equal(game.stash("0", "alice", "sky", 0, 0), null);
  assert.equal(game.createTray(), null);
  game.configureFeatures({ trays: true, edgeFilter: true });
  for (let n = 1; n <= MAX_PUZZLE_TRAYS; n++) {
    assert.equal(game.createTray().trays.at(-1), `tray-${n}`);
  }
  assert.equal(game.createTray(), null);
  assert.equal(game.renameTray("tray-1", "   "), null);
  assert.deepEqual(game.renameTray("tray-1", "  Небо  ").trayNames, { "tray-1": "Небо" });
  game.stash("0", "alice", "tray-1", 100, 100);
  game.grab("0", "bob");
  const disabled = game.configureFeatures({ trays: false, edgeFilter: false });
  assert.equal(disabled.groups[0].tray, undefined);
  assert.equal(disabled.groups[0].owner, null);
  assert.equal(game.snapshot().trayNames["tray-1"], "Небо");
  assert.equal(game.createTray(), null);

  const { definition, groups } = game.snapshot();
  groups[0] = { ...groups[0], tray: "water", dx: 5000, dy: -5000 };
  const restored = new PuzzleEngine(definition, groups);
  assert.deepEqual(restored.snapshot().trays, ["water"]);
  const group = restored.groups.get("0");
  const bounds = puzzleGroupBounds(restored.tiles, group.pieces);
  assert.equal(group.dx + bounds.right, TABLE_BOUNDS.right);
  assert.equal(group.dy + bounds.top, TABLE_BOUNDS.top);
  assert.equal(group.owner, null);
});

test("arranging clears overlaps and preserves assembled, held and other-tray groups", () => {
  const game = engine(24);
  game.configureFeatures({ trays: true, edgeFilter: false });
  game.createTray();
  game.grab("0", "alice");
  game.release("0", "alice", 0, 0);
  game.grab("1", "alice");
  game.stash("1", "alice", "tray-1", 0, 0);
  game.grab("2", "alice");
  game.stash("2", "alice", "tray-1", 0, 0);
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
  assert.ok(game.arrange(null)?.groups.length);
  const after = game.snapshot();
  for (const id of ["0", "1", "2", "3"]) {
    assert.deepEqual(after.groups.find(group => group.id === id), before.groups.find(group => group.id === id));
  }
  const table = after.groups.filter(group => !group.tray);
  for (const group of table.filter(group => !group.placed && group.owner === null)) {
    const box = bounds(group);
    assert.ok(table.every(other => other.id === group.id || !overlaps(box, bounds(other))));
    assert.ok(box.left >= TABLE_BOUNDS.left && box.right <= TABLE_BOUNDS.right);
    assert.ok(box.top >= TABLE_BOUNDS.top && box.bottom <= TABLE_BOUNDS.bottom);
  }
  assert.ok(game.arrange("tray-1")?.groups.length);
  assert.ok(!overlaps(bounds(game.groups.get("1")), bounds(game.groups.get("2"))));
  assert.deepEqual(game.snapshot().groups.filter(group => !group.tray), table);
});

test("single piece can complete; snapshots cannot mutate the engine",()=>{
  const game=engine(1),snapshot=game.snapshot();
  snapshot.groups[0].pieces.push(5);
  assert.equal(game.groups.get("0").pieces.length,1);
  game.grab("0","alice");game.release("0","alice",0,0);
  assert.equal(game.groups.get("0").placed,true);
});
