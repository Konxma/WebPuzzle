import { useId } from "react";

// Original vector artwork for the landing page, not the playable puzzle renderer.
export function PuzzleIllustration() {
  const id = useId().replaceAll(":", "");
  const artId = `${id}-art`;
  const boardId = `${id}-board`;
  const pieceId = `${id}-piece`;
  const maskId = `${id}-mask`;
  const seams = [];
  for (let column = 1; column < 8; column++) {
    const x = column * 60;
    let path = `M ${x} 0`;
    for (let row = 0; row < 6; row++) {
      const y = row * 56;
      const direction = (row + column) % 2 === 0 ? 1 : -1;
      path += ` v18 c0 3 ${direction * 9} -4 ${direction * 9} 4 c0 8 ${direction * -9} 1 ${direction * -9} 4 v30`;
    }
    seams.push(<path key={`c${column}`} d={path} />);
  }
  for (let row = 1; row < 6; row++) {
    const y = row * 56;
    let path = `M 0 ${y}`;
    for (let column = 0; column < 8; column++) {
      const direction = (row + column) % 2 === 0 ? 1 : -1;
      path += ` h20 c3 0 -4 ${direction * 8} 4 ${direction * 8} c8 0 1 ${direction * -8} 4 ${direction * -8} h32`;
    }
    seams.push(<path key={`r${row}`} d={path} />);
  }
  return <svg className="puzzle-illustration" viewBox="0 0 640 480" role="img" aria-labelledby={`${id}-title ${id}-description`}>
    <title id={`${id}-title`}>Пазл із тихою морською затокою</title>
    <desc id={`${id}-description`}>Авторська векторна ілюстрація: теракотове сонце, зелені схили, синє море та дві деталі біля складеної картини</desc>
    <defs>
      <g id={artId}>
        <path fill="#e8dcc5" d="M0 0h480v336H0z"/>
        <circle cx="337" cy="76" r="35" fill="#b96545"/>
        <path fill="#c8c8ac" d="M0 151 54 127 103 144 171 115 238 132 297 155 366 149 419 173 480 163v173H0z"/>
        <path fill="#688375" d="M0 131c67-18 89 31 148 39 65 8 110-14 171 13l161 67v86H0z"/>
        <path fill="#3e6b72" d="M480 171c-67 9-100 11-142 36-39 23-75 29-121 38-66 13-132 39-217 47v44h480z"/>
        <path fill="#d8bd91" d="M0 233c75-9 113-22 175-12 41 7 72 3 101-5-27 24-44 30-86 43-47 15-104 33-190 34z"/>
        <path fill="#37564c" d="M0 190c41 4 72 7 101 24 35 21 63 18 91 16-48 19-119 19-192 40z"/>
        <path fill="#8caaa5" d="M326 259c39-5 88-7 154-2v3c-60-4-111-3-154 1zm-80 34c76-8 132-7 191-3v3c-57-4-116-5-191 2z"/>
        <path fill="#a5b7aa" d="m28 311 49-11 34 2-47 11z"/>
        <path fill="#f1e7d5" d="m84 184 7-25 8 27zm24 9 6-18 6 20z"/>
      </g>
      <clipPath id={boardId}><rect width="480" height="336" rx="4"/></clipPath>
      <path id={pieceId} d="M0 0h20c3 0-4 8 4 8s1-8 4-8h32v18c0 3 9-4 9 4s-9 1-9 4v30H28c-3 0 4-8-4-8s-1 8-4 8H0V38c0-3 9 4 9-4s-9-1-9-4z"/>
      <mask id={maskId}><rect width="480" height="336" fill="white"/><use href={`#${pieceId}`} x="360" y="280" fill="black"/><use href={`#${pieceId}`} x="420" y="0" fill="black"/></mask>
      <clipPath id={`${id}-loose`}><use href={`#${pieceId}`}/></clipPath>
    </defs>
    <rect x="50" y="38" width="504" height="360" rx="8" fill="#e5e4dc"/>
    <g transform="translate(62 50)" clipPath={`url(#${boardId})`} mask={`url(#${maskId})`}>
      <use href={`#${artId}`}/>
      <g stroke="#233c36" strokeOpacity=".29" strokeWidth=".8" fill="none">{seams}</g>
    </g>
    <g transform="translate(550 74) rotate(14)">
      <use href={`#${pieceId}`} transform="translate(0 3)" fill="#000" opacity=".09"/>
      <g clipPath={`url(#${id}-loose)`}><use href={`#${artId}`} x="-420"/></g>
      <use href={`#${pieceId}`} fill="none" stroke="#233c36" strokeOpacity=".24"/>
    </g>
    <g transform="translate(454 414) rotate(-12)">
      <use href={`#${pieceId}`} transform="translate(0 3)" fill="#000" opacity=".09"/>
      <g clipPath={`url(#${id}-loose)`}><use href={`#${artId}`} x="-360" y="-280"/></g>
      <use href={`#${pieceId}`} fill="none" stroke="#233c36" strokeOpacity=".24"/>
    </g>
  </svg>;
}
