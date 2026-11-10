// Words for leaderboard names such as "SwiftOtter482". A player picks one
// word from each list and a number, so no name is ever typed.
// The server only accepts names made from these lists: keep them in step
// with ../leaderboard/src/index.js (its tests compare the two).
export const ADJECTIVES = [
  "Swift", "Brave", "Silent", "Lucky", "Clever", "Mighty", "Rapid", "Steady",
  "Bold", "Fierce", "Quiet", "Sharp", "Wild", "Calm", "Iron", "Golden",
  "Shadow", "Storm", "Frost", "Ember", "Rusty", "Nimble", "Gritty", "Daring",
];
export const ANIMALS = [
  "Otter", "Falcon", "Badger", "Wolf", "Fox", "Hawk", "Bear", "Lynx",
  "Raven", "Moose", "Bison", "Cobra", "Panda", "Tiger", "Gecko", "Heron",
  "Owl", "Shark", "Yak", "Puma", "Viper", "Mole", "Crane", "Ferret",
];
export const NUMBERS = 1000; // names end in 0-999

// A name as picker state: { a, b, n } = adjective index, animal index, number.
export const makeName = ({ a, b, n }) => ADJECTIVES[a] + ANIMALS[b] + n;
export function parseName(name) {
  const m = /^([A-Z][a-z]+)([A-Z][a-z]+)(0|[1-9]\d{0,2})$/.exec(name || "");
  if (!m) return null;
  const a = ADJECTIVES.indexOf(m[1]);
  const b = ANIMALS.indexOf(m[2]);
  return a < 0 || b < 0 ? null : { a, b, n: Number(m[3]) };
}
const pick = (count) => Math.floor(Math.random() * count);
export const randomName = () => ({ a: pick(ADJECTIVES.length), b: pick(ANIMALS.length), n: pick(NUMBERS) });
