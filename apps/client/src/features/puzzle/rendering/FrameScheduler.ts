// A still puzzle has no animation. Coalesce changes into one frame and sleep until the next one.
export class FrameScheduler {
  private frame:number|undefined;
  private disposed=false;
  private readonly draw:()=>void;
  private readonly requestFrame:(callback:FrameRequestCallback)=>number;
  private readonly cancelFrame:(id:number)=>void;
  constructor(
    draw:()=>void,
    requestFrame:(callback:FrameRequestCallback)=>number=callback=>requestAnimationFrame(callback),
    cancelFrame:(id:number)=>void=id=>cancelAnimationFrame(id),
  ){this.draw=draw;this.requestFrame=requestFrame;this.cancelFrame=cancelFrame;}
  request():void{
    if(this.disposed||this.frame!==undefined)return;
    this.frame=this.requestFrame(()=>{
      this.frame=undefined;
      if(!this.disposed)this.draw();
    });
  }
  dispose():void{
    this.disposed=true;
    if(this.frame!==undefined)this.cancelFrame(this.frame);
    this.frame=undefined;
  }
}
