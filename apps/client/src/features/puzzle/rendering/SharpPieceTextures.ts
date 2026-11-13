import type { Texture, Sprite } from "pixi.js";
import { pathData, type Tile } from "@web-pazle/shared";
import { bufferedCrop, containsBounds, cropResolution, detailResolution, intersectBounds, type DetailBounds } from "./detailPolicy";
import { artworkTexture, type PuzzleArtwork } from "./PuzzleArtwork";

export interface DetailPiece {
  tile:Tile;
  sprite:Sprite;
  baseTexture:Texture;
  baseBounds:DetailBounds;
  detailBounds:DetailBounds;
  bounds:DetailBounds;
}
interface Viewport extends DetailBounds { zoom:number;resolution:number }
interface Entry { texture:Texture;bounds:DetailBounds;resolution:number;pixels:number }
interface VisiblePiece { piece:DetailPiece;visible:DetailBounds;distance:number }
// Only the visible crop is rasterized. Even a 1-piece puzzle never needs a giant full-board texture.
export class SharpPieceTextures {
  private entries=new Map<number,Entry>();
  private timer:ReturnType<typeof setTimeout>|undefined;
  private running=false;
  private pending=false;
  private disposed=false;
  private revision=0;
  private pixels=0;
  private retired=new Set<Texture>();
  private readonly budget=20*1024*1024;
  constructor(
    private readonly artwork:PuzzleArtwork,
    private readonly pieces:Map<number,DetailPiece>,
    private readonly viewport:()=>Viewport,
    private readonly changed:()=>void=()=>{},
  ){}
  request():void {
    if(this.disposed)return;
    this.revision++;
    // Restore the complete base piece immediately if a pan exposes pixels outside its high-detail crop.
    const view=this.viewport();
    for(const [id,entry]of this.entries){
      const piece=this.pieces.get(id)!;
      const visible=this.visibleBounds(piece,view);
      if(visible&&!containsBounds(entry.bounds,visible))this.reset(id);
    }
    this.pending=true;
    this.arm();
  }
  private arm():void {
    // Throttle, do not debounce. Pointer/network events can arrive forever at 60Hz.
    if(this.timer!==undefined||this.running)return;
    this.timer=setTimeout(()=>{this.timer=undefined;void this.refresh();},32);
  }
  private assign(piece:DetailPiece,texture:Texture,bounds:DetailBounds):void {
    const parent=piece.sprite.parent,index=parent?.getChildIndex(piece.sprite);
    piece.sprite.texture=texture;piece.sprite.position.set(bounds.x,bounds.y);piece.bounds=bounds;
    // A batch can retain unused sources after a texture swap. Reinsert via the public scene API
    // so Pixi rebuilds its texture bindings before the old GPU source is destroyed.
    if(parent&&index!==undefined){parent.removeChild(piece.sprite);parent.addChildAt(piece.sprite,index);}
    this.changed();
  }
  private retire(texture:Texture):void {
    this.retired.add(texture);
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      if(!texture.destroyed)texture.destroy(true);
      this.retired.delete(texture);
    }));
  }
  private visibleBounds(piece:DetailPiece,view:Viewport):DetailBounds|null {
    const group=piece.sprite.parent;
    if(!group?.visible||piece.sprite.alpha===0)return null;
    return intersectBounds(piece.detailBounds,{x:view.x-group.x,y:view.y-group.y,width:view.width,height:view.height});
  }
  private reset(id:number):void {
    const entry=this.entries.get(id);if(!entry)return;
    const piece=this.pieces.get(id)!;
    this.assign(piece,piece.baseTexture,piece.baseBounds);
    this.retire(entry.texture);this.pixels-=entry.pixels;this.entries.delete(id);
  }
  private async refresh():Promise<void> {
    if(this.disposed||this.running)return;
    this.running=true;this.pending=false;
    const revision=this.revision,view=this.viewport();
    const desired=detailResolution(view.zoom,view.resolution);
    const visible:VisiblePiece[]=[];
    for(const piece of this.pieces.values()){
      const bounds=this.visibleBounds(piece,view);
      if(bounds)visible.push({piece,visible:bounds,distance:Math.hypot(bounds.x+bounds.width/2-(view.x-piece.sprite.parent!.x+view.width/2),bounds.y+bounds.height/2-(view.y-piece.sprite.parent!.y+view.height/2))});
      else this.reset(piece.tile.id);
    }
    visible.sort((a,b)=>a.distance-b.distance);
    try{
      let cursor=0;
      const worker=async()=>{while(cursor<visible.length){
        const item=visible[cursor++]!;
        if(this.disposed||revision!==this.revision)break;
        const {piece}=item,current=this.entries.get(piece.tile.id);
        // The shared atlas is also rendered at the display's target density. Keep
        // its cheap batching until zoom exceeds it, then refine visible crops only.
        if(desired<=piece.baseTexture.source.resolution){this.reset(piece.tile.id);continue;}
        const bounds=bufferedCrop(item.visible,piece.detailBounds,view.zoom,desired);
        const resolution=cropResolution(bounds,desired);
        if(current&&current.resolution===resolution&&containsBounds(current.bounds,item.visible))continue;
        const width=Math.ceil(bounds.width*resolution),height=Math.ceil(bounds.height*resolution);
        const pixels=width*height;
        // Avoid allocating a texture exceeding common GPU limits; no full-board supersampling.
        if(width>4096||height>4096||pixels>this.budget)continue;
        const texture=await this.rasterize(piece,bounds,resolution,width,height);
        if(this.disposed){texture.destroy(true);break;}
        // A motion elsewhere must not invalidate a useful completed crop. Only reject
        // it if THIS piece moved outside the crop or the display scale changed.
        const latestView=this.viewport(),latest=this.visibleBounds(piece,latestView);
        if(!latest||detailResolution(latestView.zoom,latestView.resolution)!==desired||!containsBounds(bounds,latest)){
          texture.destroy(true);continue;
        }
        this.reset(piece.tile.id);
        while(this.pixels+pixels>this.budget&&this.entries.size){
          const oldest=this.entries.keys().next().value as number;
          this.reset(oldest);
        }
        this.assign(piece,texture,bounds);
        this.entries.set(piece.tile.id,{texture,bounds,resolution,pixels});this.pixels+=pixels;
      }};
      await Promise.all([worker(),worker(),worker(),worker()]);
    }catch(error){
      // A failed optional refinement must keep the playable base texture intact.
      console.warn("Puzzle texture refinement failed",error);
    }finally{
      this.running=false;
      if(this.pending&&!this.disposed)this.arm();
    }
  }
  private async rasterize(piece:DetailPiece,bounds:DetailBounds,resolution:number,width:number,height:number):Promise<Texture>{
    return artworkTexture(this.artwork, pathData(piece.tile), bounds, resolution, width, height,
      { color: "rgba(25,45,39,.42)", width: 1 });
  }
  dispose():void {
    this.disposed=true;this.revision++;clearTimeout(this.timer);
    for(const id of [...this.entries.keys()])this.reset(id);
    for(const texture of this.retired)if(!texture.destroyed)texture.destroy(true);
    this.retired.clear();
  }
}
