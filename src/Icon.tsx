const paths = {
  stack: ['m3 7 9-4 9 4-9 4Z', 'm3 12 9 4 9-4', 'm3 17 9 4 9-4'],
  overview: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'],
  hardware: ['M6 6h12v12H6z', 'M9 9h6v6H9z', 'M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4'],
  software: ['M3 4h18v16H3z', 'M3 9h18', 'M7 6.5h.01m3 0h.01', 'm8 12-3 3 3 3m4 0h5'],
  findings: ['m12 3 10 18H2Z', 'M12 9v5m0 3h.01'],
  logs: ['M5 3h10l4 4v14H5Z', 'M14 3v5h5M8 11h8M8 15h8M8 18h5'],
  import: ['M12 3v12m-4-4 4 4 4-4', 'M4 14v6h16v-6'],
  export: ['M12 15V3m-4 4 4-4 4 4', 'M4 14v6h16v-6'],
  collect: ['M3 4h18v13H3z', 'M8 21h8m-4-4v4', 'm7 10 3 3 6-6'],
  user: ['M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0', 'M4 22v-3a8 8 0 0 1 16 0v3'],
  settings: ['M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z', 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0'],
  close: ['m6 6 12 12M6 18 18 6'],
  menu: ['M4 6h16M4 12h16M4 18h16'],
  search: ['M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0', 'm15 15 6 6'],
  plus: ['M12 4v16M4 12h16'],
};
export type IconName = keyof typeof paths;
export default function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name].map((d, i) => <path key={i} d={d} />)}</svg>;
}
