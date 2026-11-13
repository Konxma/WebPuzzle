import { Sprite, type Texture, type Container } from "pixi.js";
import { pathData, type PuzzleGroup } from "@web-pazle/shared";
import { bufferedCrop, containsBounds, cropResolution, detailResolution, intersectBounds, type DetailBounds } from "./detailPolicy";
import type { DetailPiece } from "./SharpPieceTextures";
import { artworkTexture, type PuzzleArtwork } from "./PuzzleArtwork";

interface Viewport extends DetailBounds { zoom:number;resolution:number }
interface Surface {
  sprite:Sprite;texture:Texture;members:number[];bounds:DetailBounds;
  resolution:number;seams:boolean;pixels:number;
}
// Connected pieces share one alpha silhouette. Internal edges never compose independently.
export class GroupSurfaceTextures {
  private surfaces=new Map<string,Surface>();
  private retired=new Set<Texture>();
  private timer:ReturnType<typeof setTimeout>|undefined;
  private revision=0;
  private running=false;
  private pending=false;
  private disposed=false;
  private pixels=0;
  private readonly budget=20*1024*1024;
  get count():number { return this.surfaces.size; }
  constructor(
    private readonly artwork:PuzzleArtwork,
    private readonly pieces:Map<number,DetailPiece>,
    private readonly containers:Map<string,Container>,
    private readonly groups:()=>Map<string,PuzzleGroup>,
    private readonly viewport:()=>Viewport,
    private readonly changed:()=>void,
  ){}
  request():void {
    if(this.disposed)return;
    this.revision++;this.pending=true;
    const groups=this.groups(),view=this.viewport();
    for(const [id,surface]of this.surfaces){
      const group=groups.get(id),parent=this.containers.get(id);
      if(!group||!parent||group.pieces.length!==surface.members.length){this.remove(id);continue;}
      const visible=this.visible(group,view);
      if(visible&&!containsBounds(surface.bounds,visible)){
        surface.sprite.visible=false;
        for(const member of surface.members)this.pieces.get(member)!.sprite.alpha=1;
        this.changed();
      }
    }
    this.arm();
  }
  private arm():void {
    if(this.timer!==undefined||this.running)return;
    this.timer=setTimeout(()=>{this.timer=undefined;void this.refresh();},32);
  }
  private bounds(group:PuzzleGroup):DetailBounds {
    let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
    for(const member of group.pieces){
      const rect=this.pieces.get(member)!.detailBounds;
      left=Math.min(left,rect.x);top=Math.min(top,rect.y);
      right=Math.max(right,rect.x+rect.width);bottom=Math.max(bottom,rect.y+rect.height);
    }
    return {x:left,y:top,width:right-left,height:bottom-top};
  }
  private visible(group:PuzzleGroup,view:Viewport):DetailBounds|null {
    const parent=this.containers.get(group.id);if(!parent?.visible)return null;
    return intersectBounds(this.bounds(group),{x:view.x-parent.x,y:view.y-parent.y,width:view.width,height:view.height});
  }
  private retire(texture:Texture):void {
    this.retired.add(texture);
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      if(!texture.destroyed)texture.destroy(true);this.retired.delete(texture);
    }));
  }
  private remove(id:string):void {
    const surface=this.surfaces.get(id);if(!surface)return;
    for(const member of surface.members)this.pieces.get(member)!.sprite.alpha=1;
    surface.sprite.parent?.removeChild(surface.sprite);
    surface.sprite.destroy();
    this.retire(surface.texture);this.pixels-=surface.pixels;this.surfaces.delete(id);
    this.changed();
  }
  private async refresh():Promise<void>{
    if(this.disposed||this.running)return;
    this.running=true;this.pending=false;
    const revision=this.revision,view=this.viewport();
    const desired=detailResolution(view.zoom,view.resolution);
    try{
      for(const group of this.groups().values()){
        if(this.disposed||revision!==this.revision)break;
        if(group.pieces.length<2)continue;
        const visible=this.visible(group,view);
        if(!visible){this.remove(group.id);continue;}
        const seams=Math.min(...group.pieces.map(id=>{const tile=this.pieces.get(id)!.tile;return Math.min(tile.width,tile.height); }))*view.zoom>=10;
        const previous=this.surfaces.get(group.id);
        const bounds=bufferedCrop(visible,this.bounds(group),view.zoom,desired);
        const resolution=cropResolution(bounds,desired);
        if(previous&&previous.resolution===resolution&&previous.seams===seams&&containsBounds(previous.bounds,visible)&&previous.sprite.visible)continue;
        const width=Math.ceil(bounds.width*resolution),height=Math.ceil(bounds.height*resolution),pixels=width*height;
        if(width>4096||height>4096||pixels>this.budget){this.remove(group.id);continue;}
        const outline=group.pieces.map(id=>pathData(this.pieces.get(id)!.tile)).join(" ");
        const seam = seams ? { color: "rgba(38,62,54,.18)", width: Math.max(1, .6 / view.zoom) } : undefined;
        const members=[...group.pieces];
        const texture = await artworkTexture(this.artwork, outline, bounds, resolution, width, height, seam);
        if(this.disposed){texture.destroy(true);break;}
        const latestGroup=this.groups().get(group.id),latestView=this.viewport();
        const latestVisible=latestGroup&&this.visible(latestGroup,latestView);
        if(!latestGroup||latestGroup.pieces.length!==members.length||!latestVisible||
          detailResolution(latestView.zoom,latestView.resolution)!==desired||!containsBounds(bounds,latestVisible)){
          texture.destroy(true);continue;
        }
        this.remove(group.id);
        while(this.pixels+pixels>this.budget&&this.surfaces.size)this.remove(this.surfaces.keys().next().value!);
        const parent=this.containers.get(group.id);if(!parent){texture.destroy(true);continue;}
        const sprite=new Sprite(texture);sprite.position.set(bounds.x,bounds.y);sprite.eventMode="none";
        parent.addChild(sprite);
        for(const member of group.pieces)this.pieces.get(member)!.sprite.alpha=0;
        this.surfaces.set(group.id,{sprite,texture,members,bounds,resolution,seams,pixels});
        this.pixels+=pixels;this.changed();
      }
    }catch(error){console.warn("Puzzle group surface failed",error);}
    finally{this.running=false;if(this.pending&&!this.disposed)this.arm();}
  }
  dispose():void {
    this.disposed=true;this.revision++;clearTimeout(this.timer);
    for(const id of [...this.surfaces.keys()])this.remove(id);
    for(const texture of this.retired)if(!texture.destroyed)texture.destroy(true);
    this.retired.clear();
  }
}
