import { assertPieceCount, DEFAULT_PUZZLE_SHAPE, type PuzzleShape } from "./puzzle.js";
export const BOARD_WIDTH = 1600;
export const BOARD_HEIGHT = 1000;

export interface PuzzleBounds { left: number; top: number; right: number; bottom: number }

export const SCATTER_BOUNDS = { left: -600, top: -400, right: BOARD_WIDTH + 600, bottom: BOARD_HEIGHT + 400 } as const;
export const TABLE_BOUNDS = { left: -1600, top: -1050, right: BOARD_WIDTH + 1600, bottom: BOARD_HEIGHT + 1050 } as const;
export const FIELD_SIZES = [1, 1.5, 2] as const;
export type FieldSize = typeof FIELD_SIZES[number];
export const isFieldSize = (value: unknown): value is FieldSize => FIELD_SIZES.some(size => size === value);
export function fieldBounds(size: FieldSize = 1): PuzzleBounds {
  return { left: TABLE_BOUNDS.left * size, top: TABLE_BOUNDS.top * size,
    right: BOARD_WIDTH - TABLE_BOUNDS.left * size, bottom: BOARD_HEIGHT - TABLE_BOUNDS.top * size };
}
export const TABLE_WIDTH = TABLE_BOUNDS.right - TABLE_BOUNDS.left;
export const TABLE_HEIGHT = TABLE_BOUNDS.bottom - TABLE_BOUNDS.top;

export function combinePuzzleBounds(a: PuzzleBounds, b: PuzzleBounds): PuzzleBounds {
  return {
    left: Math.min(a.left, b.left), top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom),
  };
}

export function puzzleGroupBounds(tiles: readonly Tile[], pieces: readonly number[]): PuzzleBounds {
  const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (const id of pieces) {
    for (const command of tiles[id]!.path) {
      // The curve stays within the bounds of its endpoints and control points.
      for (let i = 0; i < command.values.length; i += 2) {
        const x = command.values[i]!, y = command.values[i + 1]!;
        bounds.left = Math.min(bounds.left, x);
        bounds.top = Math.min(bounds.top, y);
        bounds.right = Math.max(bounds.right, x);
        bounds.bottom = Math.max(bounds.bottom, y);
      }
    }
  }
  return bounds;
}

export function clampGroupToTable(bounds: PuzzleBounds, dx: number, dy: number, table: PuzzleBounds = TABLE_BOUNDS) {
  return {
    dx: Math.max(table.left - bounds.left, Math.min(table.right - bounds.right, dx)),
    dy: Math.max(table.top - bounds.top, Math.min(table.bottom - bounds.bottom, dy)),
  };
}
export type DrawCommand = { op: "M" | "L"; values: [number, number] } | { op: "C"; values: [number, number, number, number, number, number] } | { op: "Z"; values: [] };
export interface Tile {
  id: number; x: number; y: number; width: number; height: number;
  neighbors: number[]; path: DrawCommand[]; edge: boolean;
}
interface Edge { a: [number,number]; b: [number,number]; sign: number; depth: number }
function edgeCommands(edge: Edge, shape: PuzzleShape): DrawCommand[] {
  const {a,b,sign,depth} = edge;
  const dx=b[0]-a[0], dy=b[1]-a[1], length=Math.hypot(dx,dy);
  const point=(t:number,d:number):[number,number]=>[a[0]+dx*t-dy/length*d*sign,a[1]+dy*t+dx/length*d*sign];
  if (shape === "wave") return [
    {op:"C",values:[...point(.2,0),...point(.27,depth),...point(.5,depth)]},
    {op:"C",values:[...point(.73,depth),...point(.8,0),...b]},
  ];
  if (shape === "angular") return [
    {op:"L",values:point(.25,0)},
    {op:"L",values:point(.38,depth)},
    {op:"L",values:point(.62,depth)},
    {op:"L",values:point(.75,0)},
    {op:"L",values:b},
  ];
  if (shape === "classic-wide" || shape === "classic-narrow") {
    const wide = shape === "classic-wide";
    const neck = wide ? .40 : .445;
    const shoulder = wide ? .27 : .37;
    const crownControl = wide ? .37 : .43;
    const height = depth * (wide ? .85 : 1);
    // Reflect the first half around the midpoint so both pieces trace the same cut.
    return [
      {op:"L",values:point(neck,0)},
      {op:"C",values:[...point(neck+.04,0),...point(shoulder,height*.20),...point(shoulder,height*.55)]},
      {op:"C",values:[...point(shoulder,height*.84),...point(crownControl,height),...point(.5,height)]},
      {op:"C",values:[...point(1-crownControl,height),...point(1-shoulder,height*.84),...point(1-shoulder,height*.55)]},
      {op:"C",values:[...point(1-shoulder,height*.20),...point(1-neck-.04,0),...point(1-neck,0)]},
      {op:"L",values:b},
    ];
  }
  return [
    {op:"L",values:point(.38,0)},
    {op:"C",values:[...point(.46,0),...point(.28,depth),...point(.5,depth)]},
    {op:"C",values:[...point(.72,depth),...point(.54,0),...point(.62,0)]},
    {op:"L",values:b},
  ];
}
function createLayout(count: number, seed: number) {
  assertPieceCount(count);
  const rows=Math.max(1,Math.min(count,Math.round(Math.sqrt(count*BOARD_HEIGHT/BOARD_WIDTH))));
  const rowTiles:Tile[][]=[];
  const tiles:Tile[]=[];
  for(let row=0;row<rows;row++){
    const columns=Math.floor(count/rows)+(row<count%rows?1:0);
    const cells:Tile[]=[];
    for(let col=0;col<columns;col++){
      const tile:Tile={id:tiles.length,x:col*BOARD_WIDTH/columns,y:row*BOARD_HEIGHT/rows,width:BOARD_WIDTH/columns,height:BOARD_HEIGHT/rows,neighbors:[],path:[],edge:row===0||row===rows-1||col===0||col===columns-1};
      tiles.push(tile);cells.push(tile);
    }
    rowTiles.push(cells);
  }
  const edges=new Map<number,Edge[][]>();
  const seams: Edge[] = [];
  for(const tile of tiles) edges.set(tile.id,[[],[],[],[]]);
  const add=(a:Tile,b:Tile,sideA:number,sideB:number,start:[number,number],end:[number,number])=>{
    a.neighbors.push(b.id);b.neighbors.push(a.id);
    const sign=((Math.imul(a.id+seed,1664525)+b.id)>>>0)%2?1:-1;
    const depth=Math.min(Math.hypot(end[0]-start[0],end[1]-start[1]),a.width,a.height,b.width,b.height)*.22;
    const seam = {a:start,b:end,sign,depth};
    edges.get(a.id)![sideA]!.push(seam);
    seams.push(seam);
    // Reverse both the direction and the sign to trace the same seam.
    edges.get(b.id)![sideB]!.push({a:end,b:start,sign:-sign,depth});
  };
  for(let row=0;row<rows;row++){
    const cells=rowTiles[row]!;
    for(let col=0;col<cells.length-1;col++){
      const a=cells[col]!,b=cells[col+1]!;
      add(a,b,1,3,[b.x,a.y],[b.x,a.y+a.height]);
    }
    const below=rowTiles[row+1];
    if(below){
      let i=0,j=0;
      while(i<cells.length&&j<below.length){
        const a=cells[i]!,b=below[j]!;
        const left=Math.max(a.x,b.x),right=Math.min(a.x+a.width,b.x+b.width);
        if(right-left>1e-7) add(a,b,2,0,[right,b.y],[left,b.y]);
        if(a.x+a.width<b.x+b.width-1e-7)i++;
        else if(b.x+b.width<a.x+a.width-1e-7)j++;
        else {i++;j++;}
      }
    }
  }
  return { tiles, edges, seams };
}

export function generateTiles(count: number, seed: number, shape: PuzzleShape = DEFAULT_PUZZLE_SHAPE): Tile[] {
  const { tiles, edges } = createLayout(count, seed);
  for(const tile of tiles){
    const all=edges.get(tile.id)!;
    const corners:[number,number][]=[[tile.x,tile.y],[tile.x+tile.width,tile.y],[tile.x+tile.width,tile.y+tile.height],[tile.x,tile.y+tile.height]];
    tile.path=[{op:"M",values:corners[0]!}];
    for(let side=0;side<4;side++){
      const segments=all[side]!;
      segments.sort((a,b)=>side===0?a.a[0]-b.a[0]:side===2?b.a[0]-a.a[0]:side===1?a.a[1]-b.a[1]:b.a[1]-a.a[1]);
      if(segments.length) for(const edge of segments) tile.path.push(...edgeCommands(edge,shape));
      else tile.path.push({op:"L",values:corners[(side+1)%4]!});
    }
    tile.path.push({op:"Z",values:[]});
  }
  return tiles;
}
function commandsToPath(commands: DrawCommand[]): string {
  return commands.map(command => command.op + command.values.join(" ")).join(" ");
}

export function pathData(tile: Tile): string {
  return commandsToPath(tile.path);
}

// The assembled preview needs each interior seam once, with the same curve as its two pieces.
export function puzzleSeamPath(count: number, seed: number, shape: PuzzleShape = DEFAULT_PUZZLE_SHAPE): string {
  const { seams } = createLayout(count, seed);
  return seams.map(seam => commandsToPath([{ op: "M", values: seam.a }, ...edgeCommands(seam, shape)])).join(" ");
}
