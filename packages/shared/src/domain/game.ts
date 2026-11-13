import { arrangeLoosePieces } from "./arrange.js";
import { clampGroupToTable, combinePuzzleBounds, generateTiles, puzzleGroupBounds, SCATTER_BOUNDS, type PuzzleBounds, type Tile } from "./geometry.js";
import { assertPieceCount, DEFAULT_PUZZLE_FEATURES, isPuzzleFeatures, isPuzzleTray, LEGACY_PUZZLE_TRAYS,
  MAX_PUZZLE_TRAYS, normalizeTrayName, type PuzzleDefinition, type PuzzleFeatures, type PuzzleTray } from "./puzzle.js";
export interface PuzzleGroup { id:string; pieces:number[]; dx:number; dy:number; owner:string|null; placed:boolean; tray?:PuzzleTray }
interface ArrangePosition { id: string; dx: number; dy: number }
interface ArrangeHistory { tray: PuzzleTray | null; positions: ArrangePosition[] }
export interface PuzzleOptions {
  arrangeHistory?: ArrangeHistory[];
  features?: PuzzleFeatures;
  trayNames?: Partial<Record<PuzzleTray, string>>;
}
export interface GameSnapshot extends PuzzleOptions { definition:PuzzleDefinition; groups:PuzzleGroup[]; trays?: PuzzleTray[] }
export interface GameDelta extends PuzzleOptions { groups:PuzzleGroup[]; removed:string[]; trays?: PuzzleTray[] }

export function featuresForSnapshot(snapshot: GameSnapshot, trays: readonly PuzzleTray[]): PuzzleFeatures {
  return snapshot.features ?? { ...DEFAULT_PUZZLE_FEATURES, trays: trays.length > 0 };
}

export function traysForSnapshot(snapshot: { groups: readonly PuzzleGroup[]; trays?: PuzzleTray[] }): PuzzleTray[] {
  return snapshot.trays ?? LEGACY_PUZZLE_TRAYS.filter(tray => snapshot.groups.some(group => group?.tray === tray));
}
function random(seed:number) { let value=seed>>>0;return ()=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return value/4294967296;}; }
export class PuzzleEngine {
  readonly tiles:Tile[];
  readonly groups=new Map<string,PuzzleGroup>();
  private readonly arrangeHistory = new Map<PuzzleTray | null, Map<string, { dx: number; dy: number }>>();
  private readonly membership=new Map<number,string>();
  private readonly bounds = new Map<string, PuzzleBounds>();
  private readonly trays: PuzzleTray[];
  private features: PuzzleFeatures;
  private readonly trayNames: Partial<Record<PuzzleTray, string>> = {};

  constructor(readonly definition:PuzzleDefinition, savedGroups?: readonly PuzzleGroup[], savedTrays?: PuzzleTray[],
    options: PuzzleOptions = {}) {
    assertPieceCount(definition.pieceCount);
    this.tiles=generateTiles(definition.pieceCount,definition.seed,definition.shape);
    const trays = traysForSnapshot({ groups: savedGroups ?? [], trays: savedTrays });
    if (!Array.isArray(trays) || trays.length > MAX_PUZZLE_TRAYS ||
      !trays.every(isPuzzleTray) || new Set(trays).size !== trays.length) throw new Error("Invalid saved trays");
    this.trays = [...trays];
    this.features = isPuzzleFeatures(options.features) ? { ...options.features } : { ...DEFAULT_PUZZLE_FEATURES, trays: trays.length > 0 };
    for (const tray of trays) {
      const name = normalizeTrayName(options.trayNames?.[tray]);
      if (name) this.trayNames[tray] = name;
    }
    if (savedGroups) {
      for (const group of savedGroups) {
        if (!group || !Array.isArray(group.pieces) || !group.pieces.length || typeof group.id !== "string" || this.groups.has(group.id) ||
          !Number.isFinite(group.dx) || !Number.isFinite(group.dy) || typeof group.placed !== "boolean" ||
          (group.tray !== undefined && (!this.trays.includes(group.tray) || group.placed))) throw new Error("Invalid saved group");
        for (const piece of group.pieces) {
          if (!Number.isInteger(piece) || !this.tiles[piece] || this.membership.has(piece)) throw new Error("Invalid saved membership");
          this.membership.set(piece, group.id);
        }
        // The old browser sessions no longer own any pieces after a restore.
        const bounds = puzzleGroupBounds(this.tiles, group.pieces);
        const position = group.placed ? { dx: 0, dy: 0 } : clampGroupToTable(bounds, group.dx, group.dy);
        this.bounds.set(group.id, bounds);
        const restored = { ...group, ...position, pieces: [...group.pieces], owner: null };
        if (!this.features.trays) delete restored.tray;
        this.groups.set(group.id, restored);
      }
      if (this.membership.size !== this.tiles.length) throw new Error("Incomplete saved puzzle");
      if (Array.isArray(options.arrangeHistory)) {
        for (const entry of options.arrangeHistory) {
          if (!entry || (entry.tray !== null && (!this.features.trays || !this.trays.includes(entry.tray))) ||
            !Array.isArray(entry.positions)) continue;
          const previous = new Map<string, { dx: number; dy: number }>();
          for (const position of entry.positions) {
            const group = position && this.groups.get(position.id);
            if (!group || group.placed || group.pieces.length !== 1 || (group.tray ?? null) !== entry.tray ||
              !Number.isFinite(position.dx) || !Number.isFinite(position.dy)) continue;
            previous.set(group.id, clampGroupToTable(this.bounds.get(group.id)!, position.dx, position.dy));
          }
          if (previous.size) this.arrangeHistory.set(entry.tray, previous);
        }
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
  snapshot():GameSnapshot {
    return { definition: this.definition, groups: [...this.groups.values()].map(g => ({...g, pieces:[...g.pieces]})),
      trays: [...this.trays], trayNames: { ...this.trayNames }, features: { ...this.features } };
  }
  saveSnapshot(): GameSnapshot {
    const arrangeHistory = [...this.arrangeHistory].filter(([, positions]) => positions.size).map(([tray, positions]) => ({
      tray, positions: [...positions].map(([id, position]) => ({ id, ...position })),
    }));
    return { ...this.snapshot(), ...(arrangeHistory.length ? { arrangeHistory } : {}) };
  }
  createTray(): GameDelta | null {
    if (!this.features.trays || this.trays.length >= MAX_PUZZLE_TRAYS) return null;
    for (let index = 1; index <= MAX_PUZZLE_TRAYS; index++) {
      const tray: PuzzleTray = `tray-${index}`;
      if (this.trays.includes(tray)) continue;
      this.trays.push(tray);
      return { groups: [], removed: [], trays: [...this.trays] };
    }
    return null;
  }
  deleteTray(tray: PuzzleTray): GameDelta | null {
    const index = this.trays.indexOf(tray);
    if (!this.features.trays || index < 0) return null;
    this.trays.splice(index, 1);
    this.arrangeHistory.delete(tray);
    delete this.trayNames[tray];
    return { groups: this.emptyTrays(tray), removed: [], trays: [...this.trays], trayNames: { ...this.trayNames } };
  }
  renameTray(tray: PuzzleTray, value: unknown): GameDelta | null {
    const name = normalizeTrayName(value);
    if (!this.features.trays || !this.trays.includes(tray) || !name) return null;
    this.trayNames[tray] = name;
    return { groups: [], removed: [], trayNames: { ...this.trayNames } };
  }
  configureFeatures(features: PuzzleFeatures): GameDelta | null {
    if (features.trays === this.features.trays && features.edgeFilter === this.features.edgeFilter) return null;
    this.features = { ...features };
    if (!features.trays) for (const tray of this.trays) this.arrangeHistory.delete(tray);
    return { groups: features.trays ? [] : this.emptyTrays(), removed: [], features: { ...features } };
  }
  private emptyTrays(tray?: PuzzleTray): PuzzleGroup[] {
    const groups: PuzzleGroup[] = [];
    for (const group of this.groups.values()) {
      if (!group.tray || (tray !== undefined && group.tray !== tray)) continue;
      delete group.tray;
      group.owner = null;
      groups.push({ ...group });
    }
    return groups;
  }
  arrange(tray: PuzzleTray | null): GameDelta | null {
    if (tray !== null && (!this.features.trays || !this.trays.includes(tray))) return null;
    const loose: { id: string; bounds: PuzzleBounds }[] = [];
    const obstacles: PuzzleBounds[] = [];
    for (const group of this.groups.values()) {
      if ((group.tray ?? null) !== tray) continue;
      const bounds = this.bounds.get(group.id)!;
      if (!group.placed && group.owner === null && group.pieces.length === 1) {
        loose.push({ id: group.id, bounds });
      } else {
        obstacles.push({ left: bounds.left + group.dx, right: bounds.right + group.dx,
          top: bounds.top + group.dy, bottom: bounds.bottom + group.dy });
      }
    }
    if (!loose.length) return null;
    const layout = arrangeLoosePieces(loose, obstacles);
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
    this.arrangeHistory.set(tray, previous);
    return { groups, removed: [] };
  }
  undoArrange(tray: PuzzleTray | null): GameDelta | null {
    const previous = this.arrangeHistory.get(tray);
    if (!previous) return null;
    const groups: PuzzleGroup[] = [];
    for (const [id, position] of previous) {
      const group = this.groups.get(id);
      if (!group || group.placed || group.owner !== null || group.pieces.length !== 1 ||
        (group.tray ?? null) !== tray) continue;
      Object.assign(group, position);
      previous.delete(id);
      groups.push({ ...group });
    }
    return groups.length ? { groups, removed: [] } : null;
  }
  grab(id:string,owner:string):GameDelta {
    const group=this.groups.get(id);
    if(!group||group.placed||(group.owner!==null&&group.owner!==owner)) return {groups:group?[{...group}]:[],removed:[]};
    const released=this.releaseOwner(owner);group.owner=owner;return {groups:[...released.groups.filter(g=>g.id!==id),{...group}],removed:[]};
  }
  move(id:string,owner:string,dx:number,dy:number):GameDelta|null {
    const group=this.groups.get(id);
    if(!group||group.owner!==owner||group.placed||!Number.isFinite(dx)||!Number.isFinite(dy)) return null;
    const position = clampGroupToTable(this.bounds.get(id)!, dx, dy);
    if (group.dx !== position.dx || group.dy !== position.dy) this.arrangeHistory.get(group.tray ?? null)?.delete(id);
    Object.assign(group, position);
    return {groups:[{...group}],removed:[]};
  }
  release(id:string,owner:string,dx:number,dy:number):GameDelta|null {
    if(!this.move(id,owner,dx,dy)) return null;
    const group=this.groups.get(id)!;
    if (group.tray) {
      group.owner = null;
      return { groups: [{ ...group }], removed: [] };
    }
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
          if(other.tray||(other.owner!==null&&other.owner!==owner))continue;
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
    Object.assign(group, group.placed ? { dx: 0, dy: 0 } : clampGroupToTable(this.bounds.get(id)!, group.dx, group.dy));
    group.owner=null;
    return {groups:[{...group,pieces:[...group.pieces]}],removed};
  }
  stash(id: string, owner: string, tray: PuzzleTray | null, dx: number, dy: number): GameDelta | null {
    if (tray !== null && (!this.features.trays || !this.trays.includes(tray))) return null;
    if (!this.move(id, owner, dx, dy)) return null;
    const group = this.groups.get(id)!;
    if ((group.tray ?? null) !== tray) this.arrangeHistory.get(group.tray ?? null)?.delete(id);
    if (tray) group.tray = tray;
    else delete group.tray;
    group.owner = null;
    return { groups: [{ ...group }], removed: [] };
  }
  releaseOwner(owner:string):GameDelta{
    const groups:PuzzleGroup[]=[];
    for(const group of this.groups.values())if(group.owner===owner){group.owner=null;groups.push({...group});}
    return {groups,removed:[]};
  }
}
