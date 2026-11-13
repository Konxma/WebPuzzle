// Moving between Windows monitors can change DPR without changing the CSS viewport.
// Re-arm the query after each change, otherwise only the first transition is observed.
export function watchDisplayDensity(changed:()=>void,
  density:()=>number=()=>window.devicePixelRatio,
  query:(value:string)=>MediaQueryList=value=>window.matchMedia(value)):()=>void {
  let current:MediaQueryList;
  const update=()=>{current.removeEventListener("change",update);arm();changed();};
  const arm=()=>{current=query(`(resolution: ${density()}dppx)`);current.addEventListener("change",update);};
  arm();
  return ()=>current.removeEventListener("change",update);
}
