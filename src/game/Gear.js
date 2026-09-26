// Gear and upgrade data. The upgrade shop (a vendor by the boathouse) is not built yet; everything
// the game reads goes through gearStats( state.upgrades ), so buying a level is just
// state.upgrades[ key ]++ and the stats follow.
//
// Each track: levels[ 0 ] is what you start with; cost is the price of that level (0 for the first).
export const UPGRADES = {
	// rod and reel
	line: { name: 'Fishing line', levels: [
		{ cost: 0, label: '8 lb mono', lineKg: 7 },
		{ cost: 60, label: '15 lb mono', lineKg: 13 },
		{ cost: 180, label: '30 lb braid', lineKg: 26 },
		{ cost: 450, label: '60 lb braid', lineKg: 50 },
	] },
	reel: { name: 'Reel', levels: [
		{ cost: 0, label: 'Old spinning reel', reelSpeed: 1.1, fishingTier: 0 },
		{ cost: 55, label: 'Serviced spinning reel', reelSpeed: 1.35, fishingTier: 1 },
		{ cost: 145, label: 'Smooth spinning reel', reelSpeed: 1.7, fishingTier: 2 },
		{ cost: 300, label: 'Coastal baitcaster', reelSpeed: 2.1, fishingTier: 3 },
		{ cost: 600, label: 'Offshore conventional reel', reelSpeed: 2.6, fishingTier: 4 },
	] },
	rod: { name: 'Rod', levels: [
		{ cost: 0, label: 'Hand-me-down rod', castM: 22, fishingTier: 0 },
		{ cost: 45, label: '6 ft fiberglass rod', castM: 27, fishingTier: 1 },
		{ cost: 120, label: '7 ft graphite rod', castM: 34, fishingTier: 2 },
		{ cost: 260, label: '8 ft coastal rod', castM: 42, fishingTier: 3 },
		{ cost: 500, label: '9 ft offshore rod', castM: 52, fishingTier: 4 },
	] },
	// boat
	hold: { name: 'Fish hold', levels: [
		{ cost: 0, label: 'Cooler', holdKg: 30 },
		{ cost: 120, label: 'Ice chest', holdKg: 70 },
		{ cost: 400, label: 'Insulated fish hold', holdKg: 160 },
	] },
	fuel: { name: 'Fuel tank', levels: [
		{ cost: 0, label: '40 L tank', fuelL: 40 },
		{ cost: 150, label: '80 L tank', fuelL: 80 },
		{ cost: 380, label: '150 L tank', fuelL: 150 },
	] },
	engine: { name: 'Engine', levels: [
		{ cost: 0, label: 'Tired diesel', speedMul: 1 },
		{ cost: 300, label: 'Rebuilt diesel', speedMul: 1.15 },
		{ cost: 700, label: 'Turbo diesel', speedMul: 1.3 },
	] },
	fishFinder: { name: 'Fish finder', levels: [
		{ cost: 0, label: 'None', finder: false },
		{ cost: 250, label: 'Fish finder (depth and fish on the HUD)', finder: true },
	] },
	lights: { name: 'Boat lights', levels: [
		{ cost: 0, label: 'Nav lights only', deckLights: false },
		{ cost: 140, label: 'Deck floodlights for night fishing', deckLights: true },
	] },
};

// Fishing access is determined by the lower of the rod and reel levels. Each complete kit is a
// meaningful milestone, while line strength remains its own choice for winning a difficult fight.
export const FISHING_TIERS = [
	{ name: 'Level 1 · Starter', color: '#99a8ad', description: 'Basic shore and pier fish', requirement: 'Hand-me-down rod + old reel' },
	{ name: 'Level 2 · Inshore', color: '#5dca76', description: 'Better pier and reef fish', requirement: 'Fiberglass rod + serviced reel' },
	{ name: 'Level 3 · Coastal', color: '#54d8c8', description: 'Valuable reef fish', requirement: 'Graphite rod + smooth reel' },
	{ name: 'Level 4 · Bluewater', color: '#718ee9', description: 'Strong bay and offshore fish', requirement: 'Coastal rod + baitcaster' },
	{ name: 'Level 5 · Gold Offshore', color: '#f0bd62', description: 'Premium trophy fish', requirement: 'Offshore rod + conventional reel' },
];

export function fishingGearTier( upgrades ) {

	const rod = UPGRADES.rod.levels[ Math.max( 0, Math.min( UPGRADES.rod.levels.length - 1, upgrades.rod | 0 ) ) ];
	const reel = UPGRADES.reel.levels[ Math.max( 0, Math.min( UPGRADES.reel.levels.length - 1, upgrades.reel | 0 ) ) ];
	return Math.min( rod.fishingTier ?? 0, reel.fishingTier ?? 0 );

}

export const FUEL_PRICE = 1.5; // $ per litre of diesel at the chandlery
// litres per second at the helm: idle plus a lot more at full rpm (40 L lasts ~25 min flat out)
export function fuelBurn( rpm ) {

	return 0.0025 + 0.024 * rpm * rpm;

}

// next level of a track, or null when maxed
export function nextLevel( upgrades, key ) {

	const lv = UPGRADES[ key ].levels;
	const i = ( upgrades[ key ] | 0 ) + 1;
	return i < lv.length ? { index: i, ...lv[ i ] } : null;

}

export function defaultUpgrades() {

	const u = {};
	for ( const k in UPGRADES ) u[ k ] = 0;
	return u;

}

// merged stats of the current levels
export function gearStats( upgrades ) {

	const s = {};
	for ( const k in UPGRADES ) {

		const lv = UPGRADES[ k ].levels;
		const i = Math.max( 0, Math.min( lv.length - 1, upgrades[ k ] | 0 ) );
		for ( const [ key, v ] of Object.entries( lv[ i ] ) ) if ( key !== 'cost' && key !== 'label' && key !== 'fishingTier' ) s[ key ] = v;

	}

	return s;

}
