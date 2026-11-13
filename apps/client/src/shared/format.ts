const plurals=new Intl.PluralRules("uk");
export function pieceNoun(count:number):string {
  const form=plurals.select(count);
  return form==="one"?"деталь":form==="few"?"деталі":"деталей";
}
