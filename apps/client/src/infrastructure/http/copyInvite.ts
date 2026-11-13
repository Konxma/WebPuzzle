export async function copyInvite(value:string):Promise<void>{
  if(navigator.clipboard&&window.isSecureContext){
    try{await navigator.clipboard.writeText(value);return;}catch{ /* Try the user-initiated legacy copy below. */ }
  }
  const previous=document.activeElement;
  const field=document.createElement("textarea");
  field.value=value;
  field.setAttribute("readonly","");
  field.style.position="fixed";
  field.style.opacity="0";
  document.body.append(field);
  try{
    field.select();
    if(!document.execCommand("copy"))throw new Error("Не вдалося скопіювати посилання");
  }finally{
    field.remove();
    if(previous instanceof HTMLElement)previous.focus();
  }
}
