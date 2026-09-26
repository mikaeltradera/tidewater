import { Group, Mesh, Vector3 } from '../engine/index.js';
import { prepare, mergePrepared, box, cylinder, sphere, tube, mat4 } from '../world/boat/GeoKit.js';
import { createPropMaterial, PAT } from './GameMaterials.js';
import { WORLD } from '../world/WorldLayout.js';

export const CRAB_TRAP_COUNT = 8;
export const CRAB_TRAP_CAPACITY = 6;
export const CRAB_TRAP_CARRY_LIMIT = 2;
export const CRAB_VALUE = 14;

// Two four-trap supply stacks: clear sand in front of the original beach pile, plus the marked
// open deck at the pier head by the fishing boat. The pier stack sits on deck, not the seabed.
export const CRAB_TRAP_CACHES = {
	beach: { x: 49.2, z: - 56.7 },
	pier: { x: 55.2, z: 38.2, y: WORLD.pier.deckHeight + 0.002 },
};
export const CRAB_HOTSPOTS = [ { x: - 155, z: - 20 }, { x: 165, z: - 20 } ];

const SHALLOW_FILL_SECONDS = 180;
const OFFSHORE_FILL_SECONDS = 75;
const HOTSPOT_FILL_SECONDS = 45;

export function defaultCrabTraps() {

	return Array.from( { length: CRAB_TRAP_COUNT }, ( _, i ) => ( { id: i + 1, cache: i < 4 ? 'beach' : 'pier', state: 'stored', x: 0, z: 0, yaw: 0, crabs: 0, soak: 0 } ) );

}

export function normalizeCrabTraps( traps ) {

	const defaults = defaultCrabTraps();
	if ( ! Array.isArray( traps ) ) return defaults;
	for ( const trap of defaults ) {

		const source = traps.find( ( item ) => item && item.id === trap.id );
		if ( ! source ) continue;
		trap.cache = source.cache in CRAB_TRAP_CACHES ? source.cache : trap.cache;
		trap.state = [ 'stored', 'carried', 'placed' ].includes( source.state ) ? source.state : 'stored';
		trap.x = Number.isFinite( source.x ) ? source.x : 0;
		trap.z = Number.isFinite( source.z ) ? source.z : 0;
		trap.yaw = Number.isFinite( source.yaw ) ? source.yaw : 0;
		trap.crabs = Math.max( 0, Math.min( CRAB_TRAP_CAPACITY, source.crabs | 0 ) );
		trap.soak = Math.max( 0, Number.isFinite( source.soak ) ? source.soak : 0 );

	}
	return defaults;

}

export function trapIsHotspot( x, z ) {

	return CRAB_HOTSPOTS.some( ( spot ) => Math.hypot( x - spot.x, z - spot.z ) < 32 );

}

export function trapFillSeconds( x, z ) {

	if ( trapIsHotspot( x, z ) ) return HOTSPOT_FILL_SECONDS;
	if ( z > WORLD.pier.zEnd + 5 ) return OFFSHORE_FILL_SECONDS;
	return SHALLOW_FILL_SECONDS;

}

export class CrabTraps {

	constructor( { scene, terrain, state } ) {

		this.terrain = terrain;
		this.state = state;
		this.material = createPropMaterial( 'crabTrap' );
		this.group = new Group();
		this.group.name = 'CrabTraps';
		scene.add( this.group );
		this.visuals = state.crabTraps.map( ( trap ) => this.createVisual( trap ) );
		this.time = 0;
		this.syncVisuals();

	}

	get carried() {

		return this.state.crabTraps.filter( ( trap ) => trap.state === 'carried' ).length;

	}

	get deployed() {

		return this.state.crabTraps.filter( ( trap ) => trap.state === 'placed' ).length;

	}

	createVisual( trap ) {

		const group = new Group();
		group.name = `CrabTrap${ trap.id }`;
		const cage = new Mesh( trapGeometry(), this.material );
		cage.castShadow = true;
		cage.receiveShadow = true;
		group.add( cage );

		const float = new Mesh( floatGeometry(), this.material );
		float.name = 'CrabTrapRedBuoy';
		float.castShadow = true;
		group.add( float );
		const tether = new Mesh( tetherGeometry(), this.material );
		tether.name = 'CrabTrapBuoyLine';
		group.add( tether );

		const crabs = new Group();
		crabs.name = 'TrapCrabs';
		for ( let i = 0; i < CRAB_TRAP_CAPACITY; i ++ ) {

			const crab = new Mesh( crabGeometry(), this.material );
			const col = i % 3, row = Math.floor( i / 3 );
			crab.position.set( ( col - 1 ) * 0.22, 0.13 + row * 0.035, ( row - 0.5 ) * 0.18 );
			crab.rotation.y = i * 1.9;
			crab.visible = false;
			crabs.add( crab );

		}
		group.add( crabs );
		this.group.add( group );
		return { group, float, tether, crabs };

	}

	update( dt ) {

		this.time += dt;
		let changed = false;
		for ( const trap of this.state.crabTraps ) {

			if ( trap.state !== 'placed' || trap.crabs >= CRAB_TRAP_CAPACITY ) continue;
			trap.soak += dt;
			const fill = trapFillSeconds( trap.x, trap.z );
			const ready = Math.min( CRAB_TRAP_CAPACITY, Math.floor( trap.soak / fill ) );
			if ( ready > trap.crabs ) {

				trap.crabs = ready;
				changed = true;

			}

		}
		if ( changed ) this.state.save();
		this.syncVisuals();

	}

	canTake( position ) {

		return this.carried < CRAB_TRAP_CARRY_LIMIT && Boolean( this.nearbyCache( position ) );

	}

	nearbyCache( position ) {

		for ( const [ name, cache ] of Object.entries( CRAB_TRAP_CACHES ) ) {

			if ( Math.hypot( position.x - cache.x, position.z - cache.z ) < 2.4 && this.state.crabTraps.some( ( trap ) => trap.state === 'stored' && trap.cache === name ) ) return name;

		}
		return null;

	}

	take( position ) {

		if ( this.carried >= CRAB_TRAP_CARRY_LIMIT ) return null;
		const cache = this.nearbyCache( position );
		const trap = cache && this.state.crabTraps.find( ( item ) => item.state === 'stored' && item.cache === cache );
		if ( ! trap ) return null;
		trap.state = 'carried';
		this.persist();
		return trap;

	}

	canDrop( position ) {

		return this.carried > 0 && this.terrain.heightAt( position.x, position.z ) < - 0.18;

	}

	drop( position, yaw = 0 ) {

		const trap = this.state.crabTraps.find( ( item ) => item.state === 'carried' );
		if ( ! trap || ! this.canDrop( position ) ) return null;
		trap.state = 'placed';
		trap.x = position.x;
		trap.z = position.z;
		trap.yaw = yaw;
		trap.crabs = 0;
		trap.soak = 0;
		this.persist();
		return { trap, hotspot: trapIsHotspot( trap.x, trap.z ) };

	}

	nearbyPlaced( position ) {

		let closest = null, distance = 2.15;
		for ( const trap of this.state.crabTraps ) {

			if ( trap.state !== 'placed' ) continue;
			const d = Math.hypot( position.x - trap.x, position.z - trap.z );
			if ( d < distance ) {

				closest = trap;
				distance = d;

			}

		}
		return closest;

	}

	haul( trap ) {

		if ( ! trap || trap.state !== 'placed' || this.carried >= CRAB_TRAP_CARRY_LIMIT ) return null;
		const crabs = trap.crabs;
		trap.state = 'carried';
		trap.crabs = 0;
		trap.soak = 0;
		this.state.addCrabs( crabs );
		this.persist();
		return crabs;

	}

	persist() {

		this.state.save();
		this.state.emit();
		this.syncVisuals();

	}

	syncVisuals() {

		for ( let i = 0; i < this.state.crabTraps.length; i ++ ) {

			const trap = this.state.crabTraps[ i ], visual = this.visuals[ i ];
			if ( trap.state === 'carried' ) {

				visual.group.visible = false;
				continue;

			}
			visual.group.visible = true;
			let x, z, y, yaw = 0;
			if ( trap.state === 'stored' ) {

				const cache = CRAB_TRAP_CACHES[ trap.cache ] || CRAB_TRAP_CACHES.beach;
				const k = ( trap.id - 1 ) % 4;
				// Four individual pots laid on the deck/sand: never stack one trap on another.
				const layout = [ [ - 0.48, - 0.34 ], [ 0.48, - 0.34 ], [ - 0.48, 0.34 ], [ 0.48, 0.34 ] ][ k ];
				x = cache.x;
				z = cache.z;
				x += layout[ 0 ];
				z += layout[ 1 ];
				y = cache.y ?? this.terrain.heightAt( x, z );

			} else {

				x = trap.x;
				z = trap.z;
				y = this.terrain.heightAt( x, z ) + 0.04;
				yaw = trap.yaw;

			}
			visual.group.position.set( x, y, z );
			visual.group.rotation.y = yaw;
			const deployed = trap.state === 'placed';
			visual.float.visible = deployed;
			visual.tether.visible = deployed;
			if ( deployed ) {

				// The cage rests on the seabed; its red buoy remains at the surface, tethered by
				// the same blue rope used on the existing beach traps.
				const surface = 0.13 + Math.sin( this.time * 1.5 + trap.id * 1.7 ) * 0.025;
				const ropeLength = Math.max( 0.3, surface - y - 0.13 );
				visual.float.position.set( 0.16, surface - y, 0.08 );
				visual.tether.position.set( 0.16, 0.13 + ropeLength * 0.5, 0.08 );
				visual.tether.scale.y = ropeLength;

			} else {

				visual.float.position.set( 0, 0.44, 0 );
				visual.tether.scale.y = 1;

			}
			for ( let c = 0; c < visual.crabs.children.length; c ++ ) {

				const crab = visual.crabs.children[ c ];
				crab.visible = trap.state === 'placed' && c < trap.crabs;
				if ( crab.visible ) crab.rotation.y = c * 1.9 + this.time * ( 0.55 + c * 0.04 );

			}

		}

	}

}

function trapGeometry() {

	const parts = [];
	const add = ( geometry, color, rough = 0.78, metal = 0, pattern = PAT.plain, matrix = null ) => parts.push( prepare( geometry, { color, rough, metal, pattern, matrix } ) );
	const wood = 0x4b3526, net = 0x46675b, rope = 0x246f9a;
	const L = 0.9, W = 0.5, R = 0.25;

	// Matches buildTrapProto in world/Props.js: the beach's wooden slat, half-round lobster pot.
	for ( const z of [ - W / 2 + 0.02, W / 2 - 0.02 ] ) add( box( L, 0.05, 0.04 ), wood, 0.9, 0, PAT.rusty, mat4( 0, 0.025, z ) );
	for ( let i = 0; i < 5; i ++ ) add( box( L - 0.04, 0.014, 0.06 ), wood, 0.9, 0, PAT.rusty, mat4( 0, 0.055, - W / 2 + 0.06 + i * 0.095 ) );
	for ( const x of [ - L / 2 + 0.03, 0, L / 2 - 0.03 ] ) {

		const arch = [ new Vector3( x, 0.05, - R + 0.01 ), new Vector3( x, 0.05 + R * 0.72, - R * 0.68 ), new Vector3( x, 0.05 + R, 0 ), new Vector3( x, 0.05 + R * 0.72, R * 0.68 ), new Vector3( x, 0.05, R - 0.01 ) ];
		add( tube( arch, 0.016, 18, 5 ), wood, 0.86, 0, PAT.rusty );

	}
	for ( let i = 0; i < 7; i ++ ) {

		const a = ( i + 0.5 ) / 7 * Math.PI;
		add( box( L - 0.02, 0.014, 0.045 ), wood, 0.9, 0, PAT.rusty, mat4( 0, 0.05 + Math.sin( a ) * ( R - 0.005 ), Math.cos( a ) * ( R - 0.005 ), - ( a - Math.PI / 2 ) ) );

	}
	// Netted ends retain the sea-green material visible on the prop stack by the pier.
	for ( const x of [ - L / 2 + 0.025, L / 2 - 0.025 ] ) for ( let i = 0; i < 4; i ++ ) {

		const a = ( i + 0.7 ) / 5 * Math.PI;
		add( box( 0.012, 0.18, 0.025 ), net, 0.74, 0, PAT.plain, mat4( x, 0.12 + Math.sin( a ) * 0.11, Math.cos( a ) * 0.19 ) );

	}
	const handle = [ new Vector3( - 0.16, 0.3, 0 ), new Vector3( - 0.08, 0.52, 0 ), new Vector3( 0.08, 0.52, 0 ), new Vector3( 0.16, 0.3, 0 ) ];
	add( tube( handle, 0.018, 16, 5 ), rope, 0.75, 0, PAT.plain );
	return mergePrepared( parts );

}

function floatGeometry() {

	const parts = [
		prepare( sphere( 0.17, 14, 10 ), { color: 0xc52f2f, rough: 0.42, metal: 0, pattern: PAT.plain, matrix: mat4( 0, 0, 0 ) } ),
		prepare( cylinder( 0.055, 0.07, 0.1, 10, 1, false ), { color: 0xf2e5c8, rough: 0.5, metal: 0, pattern: PAT.plain, matrix: mat4( 0, 0.12, 0 ) } ),
	];
	return mergePrepared( parts );

}

function tetherGeometry() {

	return mergePrepared( [ prepare( cylinder( 0.012, 0.012, 1, 7, 1, false ), { color: 0x246f9a, rough: 0.78, metal: 0, pattern: PAT.plain, matrix: mat4( 0, 0, 0 ) } ) ] );

}

function crabGeometry() {

	const parts = [];
	const add = ( geometry, matrix ) => parts.push( prepare( geometry, { color: 0xbb5138, rough: 0.62, metal: 0, pattern: PAT.plain, matrix } ) );
	add( sphere( 0.07, 10, 7 ), mat4( 0, 0, 0, 0, 0, 0, 1.2, 0.55, 0.8 ) );
	for ( const x of [ - 0.07, 0.07 ] ) for ( const z of [ - 0.045, 0.045 ] ) add( box( 0.11, 0.012, 0.012 ), mat4( x, - 0.025, z, z > 0 ? 0.55 : - 0.55 ) );
	return mergePrepared( parts );

}
