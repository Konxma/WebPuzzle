import { arrangeLoosePieces } from "./arrange.js";
import { slideCollection } from "./collectionPhysics.js";
import { fieldBounds, isFieldSize, type FieldSize, clampGroupToTable, combinePuzzleBounds, generateTiles, puzzleGroupBounds, SCATTER_BOUNDS, type PuzzleBounds, type Tile } from "./geometry.js";
import { assertPieceCount, type PuzzleDefinition } from "./puzzle.js";
export interface PuzzleGroup { id:string; pieces:number[]; dx:number; dy:number; owner:string|null; placed:boolean; stored?: true }
interface ArrangePosition { id: string; dx: number; dy: number }
export interface CollectionPosition { dx: number; dy: number; stored: boolean }
export interface GameSnapshot { fieldSize?: FieldSize; definition:PuzzleDefinition; groups:PuzzleGroup[]; arrangeHistory?: ArrangePosition[] }
export interface GameDelta { fieldSize?: FieldSize; groups:PuzzleGroup[]; removed:string[] }

function random(seed:number) { let value=seed>>>0;return ()=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return value/4294967296;}; }
export class PuzzleEngine {
  readonly tiles:Tile[];
  readonly groups=new Map<string,PuzzleGroup>();
  private arrangeHistory = new Map<string, { dx: number; dy: number }>();
  private readonly membership=new Map<number,string>();
  private readonly bounds = new Map<string, PuzzleBounds>();
  constructor(readonly definition:PuzzleDefinition, savedGroups?: readonly PuzzleGroup[],
    arrangeHistory: GameSnapshot["arrangeHistory"] = [], public fieldSize: FieldSize = 1) {
    if (!isFieldSize(fieldSize)) this.fieldSize = 1;
    assertPieceCount(definition.pieceCount);
    this.tiles=generateTiles(definition.pieceCount,definition.seed,definition.shape);
    if (savedGroups) {
      for (const group of savedGroups) {
        if (!group || !Array.isArray(group.pieces) || !group.pieces.length || typeof group.id !== "string" || this.groups.has(group.id) ||
          !Number.isFinite(group.dx) || !Number.isFinite(group.dy) || typeof group.placed !== "boolean") throw new Error("Invalid saved group");
        for (const piece of group.pieces) {
          if (!Number.isInteger(piece) || !this.tiles[piece] || this.membership.has(piece)) throw new Error("Invalid saved membership");
          this.membership.set(piece, group.id);
        }
        // The old browser sessions no longer own any pieces after a restore.
        const bounds = puzzleGroupBounds(this.tiles, group.pieces);
        const position = group.placed ? { dx: 0, dy: 0 } : clampGroupToTable(bounds, group.dx, group.dy, this.table);
        this.bounds.set(group.id, bounds);
        this.groups.set(group.id, { id: group.id, pieces: [...group.pieces], ...position, placed: group.placed, owner: null, ...(!group.placed && group.stored === true ? { stored: true as const } : {}) });
      }
      if (this.membership.size !== this.tiles.length) throw new Error("Incomplete saved puzzle");
      for (const position of arrangeHistory) {
        const group = position && this.groups.get(position.id);
        if (!group || group.placed || group.pieces.length !== 1 ||
          !Number.isFinite(position.dx) || !Number.isFinite(position.dy)) continue;
        this.arrangeHistory.set(group.id, clampGroupToTable(this.bounds.get(group.id)!, position.dx, position.dy, this.table));
      }
      return;
    }
    const next=random(definition.seed);
    for(const tile of this.tiles){
      const id = String(tile.id);
      const bounds = puzzleGroupBounds(this.tiles, [tile.id]);
      const dx = SCATTER_BOUNDS.left - bounds.left + next() * (SCATTER_BOUNDS.right - SCATTER_BOUNDS.left - (bounds.right - bounds.left));
      const dy = SCATTER_BOUNDS.top - bounds.top + next() * (SCATTER_BOUNDS.bottom - SCATTER_BOUNDS.top - (bounds.bottom - bounds.top));
      const group:PuzzleGroup={id,pieces:[tile.id],dx,dy,owner:null,placed:false};
      this.bounds.set(id, bounds);
      this.groups.set(group.id,group);this.membership.set(tile.id,group.id);
    }
  }
  get table() { return fieldBounds(this.fieldSize); }
  resizeField(size: FieldSize): GameDelta | null {
    if (!isFieldSize(size) || size === this.fieldSize) return null;
    this.fieldSize = size;
    const groups: PuzzleGroup[] = [];
    for (const g of this.groups.values()) {
      const p = clampGroupToTable(this.bounds.get(g.id)!, g.dx, g.dy, this.table);
      if (p.dx !== g.dx || p.dy !== g.dy) {
        Object.assign(g,p);
        groups.push({...g});
      }
    }
    for (const [id, pos] of this.arrangeHistory) {
      const bounds = this.bounds.get(id);
      if (bounds) this.arrangeHistory.set(id,clampGroupToTable(bounds,pos.dx,pos.dy,this.table));
    }
    return {fieldSize:size,groups,removed:[]};
  }
  snapshot():GameSnapshot {
    return { fieldSize: this.fieldSize, definition: this.definition, groups: [...this.groups.values()].map(g => ({...g, pieces:[...g.pieces]})) };
  }
  saveSnapshot(): GameSnapshot {
    const arrangeHistory = [...this.arrangeHistory].map(([id, position]) => ({ id, ...position }));
    return { ...this.snapshot(), ...(arrangeHistory.length ? { arrangeHistory } : {}) };
  }
  arrange(): GameDelta | null {
    const loose: { id: string; bounds: PuzzleBounds }[] = [];
    const obstacles: PuzzleBounds[] = [];
    for (const group of this.groups.values()) {
      if (group.stored) continue;
      const bounds = this.bounds.get(group.id)!;
      if (!group.placed && group.owner === null && group.pieces.length === 1) {
        loose.push({ id: group.id, bounds });
      } else {
        obstacles.push({ left: bounds.left + group.dx, right: bounds.right + group.dx,
          top: bounds.top + group.dy, bottom: bounds.bottom + group.dy });
      }
    }
    if (!loose.length) return null;
    const layout = arrangeLoosePieces(loose, obstacles, this.table);
    if (!layout) return null;
    const groups: PuzzleGroup[] = [];
    const previous = new Map<string, { dx: number; dy: number }>();
    for (const { id, dx, dy } of layout) {
      const group = this.groups.get(id)!;
      if (group.dx === dx && group.dy === dy) continue;
      previous.set(id, { dx: group.dx, dy: group.dy });
      Object.assign(group, { dx, dy });
      groups.push({ ...group });
    }
    if (!groups.length) return null;
    this.arrangeHistory = previous;
    return { groups, removed: [] };
  }
  undoArrange(): GameDelta | null {
    const previous = this.arrangeHistory;
    const groups: PuzzleGroup[] = [];
    for (const [id, position] of previous) {
      const group = this.groups.get(id);
      if (!group || group.stored || group.placed || group.owner !== null || group.pieces.length !== 1) continue;
      Object.assign(group, position);
      previous.delete(id);
      groups.push({ ...group });
    }
    return groups.length ? { groups, removed: [] } : null;
  }
  collect(ids: string[], action: "move" | "slide" | "store" | "restore", x: number, y: number): GameDelta | null {
    const groups = [...new Set(ids)].map(id => this.groups.get(id));
    if (!groups.length || groups.some(g => !g || g.owner || g.placed || !!g.stored !== (action === "restore"))) return null;
    const picked = groups as PuzzleGroup[];
    // Rigid moves share one translation. Sliding groups stop independently.
    if (action !== "slide") for (const g of picked) {
      const p = clampGroupToTable(this.bounds.get(g.id)!, g.dx + x, g.dy + y, this.table);
      x = p.dx - g.dx;
      y = p.dy - g.dy;
    }
    const slides = action === "slide"
      ? slideCollection(picked.map(g => ({ id:g.id, dx:g.dx, dy:g.dy, bounds:this.bounds.get(g.id)! })), x, y, this.table)
      : undefined;
    for (const [index, g] of picked.entries()) {
      const position = slides?.[index] ?? clampGroupToTable(this.bounds.get(g.id)!, g.dx+x, g.dy+y, this.table);
      if (g.dx !== position.dx || g.dy !== position.dy || action === "store" || action === "restore") this.arrangeHistory.delete(g.id);
      if (action === "store") g.stored = true;
      else delete g.stored;
      g.dx = position.dx;
      g.dy = position.dy;
    }
    return { groups: picked.map(g => ({ ...g })), removed: [] };
  }
  undoCollection(positions: ReadonlyMap<string, CollectionPosition>): GameDelta | null {
    if (!positions.size) return null;
    for (const id of positions.keys()) {
      const group = this.groups.get(id);
      if (!group || group.owner || group.placed) return null;
    }
    const groups: PuzzleGroup[] = [];
    for (const [id, position] of positions) {
      const group = this.groups.get(id)!;
      Object.assign(group, clampGroupToTable(this.bounds.get(id)!, position.dx, position.dy, this.table));
      if (position.stored) group.stored = true;
      else delete group.stored;
      this.arrangeHistory.delete(id);
      groups.push({ ...group });
    }
    return { groups, removed: [] };
  }
  grab(id:string,owner:string,additional = false):GameDelta {
    const group=this.groups.get(id);
    if(!group||group.stored||group.placed||(group.owner!==null&&group.owner!==owner)) return {groups:group?[{...group}]:[],removed:[]};
    const released=additional ? { groups: [] } : this.releaseOwner(owner);group.owner=owner;return {groups:[...released.groups.filter(g=>g.id!==id),{...group}],removed:[]};
  }
  move(id:string,owner:string,dx:number,dy:number):GameDelta|null {
    const group=this.groups.get(id);
    if(!group||group.owner!==owner||group.placed||!Number.isFinite(dx)||!Number.isFinite(dy)) return null;
    const position = clampGroupToTable(this.bounds.get(id)!, dx, dy, this.table);
    if (group.dx !== position.dx || group.dy !== position.dy) this.arrangeHistory.delete(id);
    Object.assign(group, position);
    return {groups:[{...group}],removed:[]};
  }
  release(id:string,owner:string,dx:number,dy:number):GameDelta|null {
    if(!this.move(id,owner,dx,dy)) return null;
    const group=this.groups.get(id)!;
    const removed:string[]=[];
    const tolerance=Math.max(4,Math.min(...group.pieces.map(p=>Math.min(this.tiles[p]!.width,this.tiles[p]!.height)))*.28);
    if(Math.hypot(group.dx,group.dy)<tolerance){group.dx=0;group.dy=0;group.placed=true;}
    // Membership lookup keeps checks proportional to the moving cluster, not the entire puzzle.
    let merged=true;
    while(merged){
      merged=false;
      for(const piece of [...group.pieces]){
        for(const neighbor of this.tiles[piece]!.neighbors){
          const otherId=this.membership.get(neighbor)!;
          if(otherId===group.id)continue;
          const other=this.groups.get(otherId)!;
          if(other.stored || other.owner!==null)continue;
          if(Math.hypot(group.dx-other.dx,group.dy-other.dy)>tolerance)continue;
          group.dx=other.dx;group.dy=other.dy;group.placed=group.placed||other.placed;
          group.pieces.push(...other.pieces);
          for(const member of other.pieces)this.membership.set(member,group.id);
          this.bounds.set(id, combinePuzzleBounds(this.bounds.get(id)!, this.bounds.get(otherId)!));
          this.bounds.delete(otherId);
          this.groups.delete(otherId);removed.push(otherId);merged=true;
        }
      }
    }
    Object.assign(group, group.placed ? { dx: 0, dy: 0 } : clampGroupToTable(this.bounds.get(id)!, group.dx, group.dy, this.table));
    group.owner=null;
    return {groups:[{...group,pieces:[...group.pieces]}],removed};
  }
  cancelDrag(id: string, owner: string, dx: number, dy: number): GameDelta | null {
    if (!this.move(id, owner, dx, dy)) return null;
    const group = this.groups.get(id)!;
    group.owner = null;
    return { groups: [{ ...group }], removed: [] };
  }
  releaseOwner(owner:string):GameDelta{
    const groups:PuzzleGroup[]=[];
    for(const group of this.groups.values())if(group.owner===owner){group.owner=null;groups.push({...group});}
    return {groups,removed:[]};
  }
}
