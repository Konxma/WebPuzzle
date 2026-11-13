export interface DetailBounds { x:number;y:number;width:number;height:number }
export function detailResolution(zoom:number,screenResolution:number):number {
  // Rasterize from the original at twice the displayed pixel density, including when
  // zoomed OUT. Minifying the old 1x atlas through several mip levels softened small
  // pieces; nearest-neighbour magnification merely replaced that blur with jaggies.
  return Math.ceil(Math.max(.125,zoom*screenResolution*2)*8)/8;
}
export function cropResolution(bounds:DetailBounds,desired:number):number {
  // Large single pieces and connected groups must still refine on high-DPI monitors.
  // Reduce oversampling to fit a portable GPU texture instead of skipping refinement.
  return Math.min(desired,4096/Math.ceil(bounds.width),4096/Math.ceil(bounds.height));
}
export function intersectBounds(a:DetailBounds,b:DetailBounds):DetailBounds|null {
  const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y);
  const right=Math.min(a.x+a.width,b.x+b.width),bottom=Math.min(a.y+a.height,b.y+b.height);
  return right>x&&bottom>y?{x,y,width:right-x,height:bottom-y}:null;
}
export function containsBounds(outer:DetailBounds,inner:DetailBounds):boolean {
  return outer.x<=inner.x+.001&&outer.y<=inner.y+.001&&outer.x+outer.width>=inner.x+inner.width-.001&&outer.y+outer.height>=inner.y+inner.height-.001;
}
export function bufferedCrop(visible:DetailBounds,piece:DetailBounds,zoom:number,resolution:number):DetailBounds {
  const padding=64/zoom,step=32/resolution;
  const left=Math.max(piece.x,Math.floor((visible.x-padding)/step)*step);
  const top=Math.max(piece.y,Math.floor((visible.y-padding)/step)*step);
  const right=Math.min(piece.x+piece.width,Math.ceil((visible.x+visible.width+padding)/step)*step);
  const bottom=Math.min(piece.y+piece.height,Math.ceil((visible.y+visible.height+padding)/step)*step);
  return {x:left,y:top,width:right-left,height:bottom-top};
}
