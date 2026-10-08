export type Rank = {
  id: string;
  name: string;
  team: string;
  points: number;
  held: number;
  qualified: number;
  contracts: number;
  position: number;
  active: boolean;
};
export type Board = {
  individual: Rank[];
  teams: {
    id: string;
    name: string;
    participants: number;
    points: number;
    held: number;
  }[];
  held: number;
  qualified: number;
  contracts: number;
  active_sdrs: number;
};
