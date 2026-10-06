/** How a zone kind is drawn on the plan: the same colour language as the 3D view (roads grey, lawns green…). */
export interface ZoneStyle {
  readonly fill: string;
  readonly opacity: number;
  readonly stroke: string;
  readonly dash: string | undefined;
  /** Whether the kind's name is worth printing inside it (not on every parking bay). */
  readonly label: boolean;
}

export function zoneStyle(kind: string): ZoneStyle {
  switch (kind) {
    case 'road':
    case 'lane-one-way':
    case 'lane-two-way':
      return { fill: '#7d8187', opacity: 0.42, stroke: '#5c6066', dash: undefined, label: true };
    case 'green':
      return { fill: '#7fae62', opacity: 0.45, stroke: '#5c8a45', dash: undefined, label: false };
    case 'footpath':
    case 'plaza':
      return { fill: '#d3c3a6', opacity: 0.55, stroke: '#a8977a', dash: undefined, label: true };
    case 'yard':
      return { fill: '#c6cbd3', opacity: 0.45, stroke: '#858c98', dash: '5 4', label: true };
    case 'bay':
      return { fill: '#ffffff', opacity: 0.35, stroke: '#858c98', dash: undefined, label: false };
    case 'no-go':
    case 'pedestrian':
      return { fill: '#d7a79d', opacity: 0.21, stroke: '#a85f54', dash: '5 4', label: true };
    case 'storage':
      return { fill: '#b9c9e2', opacity: 0.13, stroke: '#55789f', dash: '5 4', label: true };
    case 'clean-room':
      return { fill: '#9fc3e0', opacity: 0.22, stroke: '#3d7fc4', dash: '5 4', label: true };
    case 'break':
    case 'lounge':
      return { fill: '#e6cfae', opacity: 0.3, stroke: '#a88758', dash: '5 4', label: true };
    default:
      return { fill: kind.includes('aisle') ? '#c9dfd4' : '#b9c9e2', opacity: 0.21, stroke: '#55789f', dash: '5 4', label: true };
  }
}
