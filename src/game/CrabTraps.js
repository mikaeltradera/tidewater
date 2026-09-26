import { Group, Matrix4, Mesh, Vector3 } from '../engine/index.js';
import { loadGLB } from '../engine/loaders/GLTF.js';
import { SkinnedModel } from '../engine/render/Skinning.js';
import { prepare, mergePrepared, box, cylinder, sphere, tube, mat4 } from '../world/boat/GeoKit.js';
import { createPropMaterial, PAT } from './GameMaterials.js';
import { WORLD } from '../world/WorldLayout.js';

export const CRAB_TRAP_COUNT = 8;
export const CRAB_TRAP_CAPACITY = 6;
export const CRAB_TRAP_CARRY_LIMIT = 2;
export const CRAB_VALUE = 3;

// Two usable supply stacks: one on the pier head by the fishing boat, and one on the
// sand beside the yellow rowboat at the pier foot. Each holds four empty traps.
export const CRAB_TRAP_CACHES = {
	pier: { x: 55.2, z: 38.2, y: WORLD.pier.deckHeight + 0.002 },
	beach: { x: 60.4, z: - 63.2 },
};
export const CRAB_HOTSPOTS = [ { x: - 155, z: - 20 }, { x: 165, z: - 20 } ];

const SHALLOW_FILL_SECONDS = 180;
const OFFSHORE_FILL_SECONDS = 75;
const HOTSPOT_FILL_SECONDS = 45;
const LAND_DEATH_SECONDS = 180;
// The model's longest axis now follows the pot's 0.9 m length, rather than its narrow
// 0.5 m width. This gives the three catch sizes room to read clearly while staying enclosed.
const CRAB_SCALES = [ 0.095, 0.11, 0.125 ];
const CRAB_SLOTS = [
	[ - 0.18, 0.17, - 0.11, 0.15 ], [ 0, 0.17, - 0.11, - 0.12 ], [ 0.18, 0.17, - 0.11, 0.1 ],
	[ - 0.18, 0.17, 0.11, - 0.12 ], [ 0, 0.17, 0.11, 0.16 ], [ 0.18, 0.17, 0.11, - 0.1 ],
];
const _carryMatrix = new Matrix4();

export function defaultCrabTraps() {

	return Array.from( { length: CRAB_TRAP_COUNT }, ( _, i ) => ( { id: i + 1, cache: i < 4 ? 'pier' : 'beach', state: 'stored', x: 0, z: 0, yaw: 0, crabs: 0, crabSizes: [], landSeconds: 0, crabsDead: false, soak: 0 } ) );

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
		trap.crabSizes = Array.isArray( source.crabSizes ) ? source.crabSizes.filter( ( size ) => Number.isInteger( size ) && size >= 0 && size < CRAB_SCALES.length ).slice( 0, trap.crabs ) : [];
		while ( trap.crabSizes.length < trap.crabs ) trap.crabSizes.push( Math.floor( Math.random() * CRAB_SCALES.length ) );
		trap.landSeconds = Math.max( 0, Number.isFinite( source.landSeconds ) ? source.landSeconds : 0 );
		trap.crabsDead = !! source.crabsDead && trap.crabs > 0;
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
		// A small first-person confirmation of the traps in the player's hands. These use the
		// same weathered cage geometry, but are camera-relative and have no collision or shadow cost.
		this.carryGroup = new Group();
		this.carryGroup.name = 'CarriedCrabTraps';
		this.carryGroup.matrixAutoUpdate = false;
		this.carryGroup.visible = false;
		const heldGeometry = trapGeometry();
		this.carryMeshes = [ 0, 1 ].map( ( i ) => {

			const mesh = new Mesh( heldGeometry, this.material );
			mesh.name = `CarriedCrabTrap${ i + 1 }`;
			mesh.castShadow = false;
			mesh.receiveShadow = false;
			mesh.scale.set( 0.88, 0.88, 0.88 );
			mesh.position.set( i ? - 0.08 : 0.04, i ? 0.035 : - 0.025, i ? 0.12 : 0 );
			mesh.rotation.set( i ? - 0.14 : - 0.2, i ? - 0.5 : - 0.38, i ? 0.1 : 0.12 );
			mesh.visible = false;
			this.carryGroup.add( mesh );
			return mesh;

		} );
		scene.add( this.carryGroup );
		this.visuals = state.crabTraps.map( ( trap ) => this.createVisual( trap ) );
		this.time = 0;
		this.animationElapsed = 0;
		// The asset textures are shared by all instances. This allows a full pot to show its six
		// real, animated crabs without multiplying its texture memory sixfold.
		this.crabTextureCache = new Map();
		this.crabModelsReady = this.loadCrabModels().catch( ( error ) => console.warn( 'crab model failed to load', error ) );
		this.syncVisuals();

	}

	get carried() {

		return this.state.crabTraps.filter( ( trap ) => trap.state === 'carried' ).length;

	}

	get deployed() {

		return this.state.crabTraps.filter( ( trap ) => trap.state === 'placed' ).length;

	}

	get carriedCrabs() {

		return this.state.crabTraps.reduce( ( total, trap ) => total + ( trap.state === 'carried' && ! trap.crabsDead ? trap.crabs : 0 ), 0 );

	}

	get carriedDeadCrabs() {

		return this.state.crabTraps.reduce( ( total, trap ) => total + ( trap.state === 'carried' && trap.crabsDead ? trap.crabs : 0 ), 0 );

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
		group.add( crabs );
		this.group.add( group );
		return { group, float, tether, crabs, models: [] };

	}

	async loadCrabModels() {

		const base = ( import.meta.env && import.meta.env.BASE_URL ) || '/';
		const gltf = await loadGLB( base + 'models/wildlife/japanese-freshwater-crab-cc0.glb' );
		for ( const visual of this.visuals ) for ( let slot = 0; slot < CRAB_TRAP_CAPACITY; slot ++ ) {

			const model = await SkinnedModel.create( gltf, { textureCache: this.crabTextureCache } );
			for ( const material of model.materials ) material.underwaterLighting = 'lite';
			for ( const mesh of model.meshes ) {

				mesh.frustumCulled = false;
				mesh.castShadow = false;
				mesh.receiveShadow = false;

			}
			const [ x, y, z, turn ] = CRAB_SLOTS[ slot ];
			model.group.position.set( x, y, z );
			model.group.rotation.y = turn;
			model.group.visible = false;
			model.play( model.clipNames()[ 0 ], { fade: 0.01, loop: true } );
			model.update( 0 );
			visual.models.push( model );
			visual.crabs.add( model.group );

		}
		this.syncVisuals();

	}

	update( dt, viewer = null ) {

		this.time += dt;
		let changed = false;
		for ( const trap of this.state.crabTraps ) {

			if ( trap.state !== 'placed' ) continue;
			const submerged = this.isSubmerged( trap.x, trap.z );
			if ( trap.crabs > 0 && ! trap.crabsDead ) {

				if ( submerged ) trap.landSeconds = 0;
				else {

					trap.landSeconds += dt;
					if ( trap.landSeconds >= LAND_DEATH_SECONDS ) {

						trap.crabsDead = true;
						changed = true;

					}

				}

			}
			if ( ! submerged || trap.crabsDead || trap.crabs >= CRAB_TRAP_CAPACITY ) continue;
			trap.soak += dt;
			const fill = trapFillSeconds( trap.x, trap.z );
			const ready = Math.min( CRAB_TRAP_CAPACITY, Math.floor( trap.soak / fill ) );
			if ( ready > trap.crabs ) {

				while ( trap.crabSizes.length < ready ) trap.crabSizes.push( Math.floor( Math.random() * CRAB_SCALES.length ) );
				trap.crabs = ready;
				changed = true;

			}

		}
		if ( changed ) this.state.save();
		this.syncVisuals();
		this.updateCrabModels( dt, viewer );

	}

	updateCrabModels( dt, viewer ) {

		this.animationElapsed += dt;
		if ( this.animationElapsed < 1 / 20 ) return;
		const elapsed = this.animationElapsed;
		this.animationElapsed = 0;
		for ( let i = 0; i < this.state.crabTraps.length; i ++ ) {

			const trap = this.state.crabTraps[ i ], models = this.visuals[ i ].models;
			if ( ! models.length ) continue;
			const nearEnough = ! viewer || Math.hypot( viewer.x - trap.x, viewer.z - trap.z ) < 26;
			for ( let slot = 0; slot < models.length; slot ++ ) {

				const model = models[ slot ];
				const visible = trap.state === 'placed' && slot < trap.crabs && nearEnough;
				model.group.visible = visible;
				if ( visible && ! trap.crabsDead ) model.update( elapsed );
				else model.hold();

			}

		}

	}

	updateCarryVisual( camera, walking ) {

		const count = this.carried;
		this.carryGroup.visible = walking && count > 0;
		if ( ! this.carryGroup.visible ) return;
		camera.updateMatrixWorld();
		// Bottom-right of the view, close enough to read as carried gear without obscuring the path.
		_carryMatrix.makeTranslation( 0.34, - 0.43, - 0.78 );
		this.carryGroup.matrix.multiplyMatrices( camera.matrixWorld, _carryMatrix );
		this.carryGroup.matrixWorldNeedsUpdate = true;
		this.carryMeshes[ 0 ].visible = count >= 1;
		this.carryMeshes[ 1 ].visible = count >= 2;

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

		return this.carried > 0;

	}

	isSubmerged( x, z ) {

		return this.terrain.heightAt( x, z ) < - 0.18;

	}

	drop( position, yaw = 0 ) {

		const trap = this.state.crabTraps.find( ( item ) => item.state === 'carried' );
		if ( ! trap || ! this.canDrop( position ) ) return null;
		trap.state = 'placed';
		trap.x = position.x;
		trap.z = position.z;
		trap.yaw = yaw;
		// A filled trap remains filled if it is carried ashore or moved to another spot. Empty
		// traps begin a new soak; only selling the catch to Joe clears a trap's contents.
		if ( trap.crabs === 0 ) {

			trap.crabSizes = [];
			trap.landSeconds = 0;
			trap.crabsDead = false;
			trap.soak = 0;

		}
		this.persist();
		return { trap, submerged: this.isSubmerged( trap.x, trap.z ), hotspot: trapIsHotspot( trap.x, trap.z ) };

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
		this.persist();
		return crabs;

	}

	sellCarriedCrabs() {

		let count = 0;
		for ( const trap of this.state.crabTraps ) {

			if ( trap.state !== 'carried' || trap.crabs <= 0 || trap.crabsDead ) continue;
			count += trap.crabs;
			trap.crabs = 0;
			trap.crabSizes = [];
			trap.landSeconds = 0;
			trap.crabsDead = false;
			trap.soak = 0;

		}
		if ( count ) this.persist();
		return { count, total: count * CRAB_VALUE };

	}

	// Cooking uses one *live* crab from a trap in the player's hands. Traps left in
	// the water or on the beach are never touched by the grill.
	takeCarriedCrab() {

		const trap = this.state.crabTraps.find( ( item ) => item.state === 'carried' && item.crabs > 0 && ! item.crabsDead );
		if ( ! trap ) return false;
		trap.crabs --;
		trap.crabSizes.pop();
		if ( trap.crabs === 0 ) {

			trap.landSeconds = 0;
			trap.crabsDead = false;

		}
		this.persist();
		return true;

	}

	emptyCarriedDeadTraps() {

		let count = 0;
		for ( const trap of this.state.crabTraps ) {

			if ( trap.state !== 'carried' || ! trap.crabsDead ) continue;
			count += trap.crabs;
			trap.crabs = 0;
			trap.crabSizes = [];
			trap.landSeconds = 0;
			trap.crabsDead = false;
			trap.soak = 0;

		}
		if ( count ) this.persist();
		return count;

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

				const cache = CRAB_TRAP_CACHES[ trap.cache ] || CRAB_TRAP_CACHES.pier;
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
			const submerged = trap.state === 'placed' && this.isSubmerged( x, z );
			visual.float.visible = submerged;
			visual.tether.visible = submerged;
			if ( submerged ) {

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
			for ( let slot = 0; slot < visual.models.length; slot ++ ) {

				const model = visual.models[ slot ];
				const scale = CRAB_SCALES[ trap.crabSizes[ slot ] ?? 1 ];
				model.group.scale.set( scale, scale, scale );

			}

		}

	}

}

function trapGeometry() {

	const parts = [];
	const add = ( geometry, color, rough = 0.78, metal = 0, pattern = PAT.plain, matrix = null ) => parts.push( prepare( geometry, { color, rough, metal, pattern, matrix } ) );
	const wood = [ 0x433027, 0x604735, 0x765941, 0x4f3a2c, 0x80614a ];
	const net = 0x46675b, rope = 0x246f9a;
	const L = 0.9, W = 0.5, R = 0.25;
	const timber = ( geometry, seed, matrix ) => add( geometry, wood[ seed % wood.length ], 0.92, 0, PAT.rusty, matrix );

	// Direct runtime counterpart of buildTrapProto in world/Props.js, which creates the original
	// beach prop. Keep its dimensions, half-round ribs, seven curved slats and sea-green net ends.
	for ( const [ i, z ] of [ - W / 2 + 0.02, W / 2 - 0.02 ].entries() ) timber( box( L, 0.05, 0.04 ), i, mat4( 0, 0.025, z ) );
	for ( let i = 0; i < 5; i ++ ) timber( box( L - 0.04, 0.014, 0.06 ), i + 2, mat4( 0, 0.055, - W / 2 + 0.06 + i * 0.095 ) );
	for ( const x of [ - L / 2 + 0.03, 0, L / 2 - 0.03 ] ) {

		const arch = [ new Vector3( x, 0.05, - R + 0.01 ), new Vector3( x, 0.05 + R * 0.72, - R * 0.68 ), new Vector3( x, 0.05 + R, 0 ), new Vector3( x, 0.05 + R * 0.72, R * 0.68 ), new Vector3( x, 0.05, R - 0.01 ) ];
		timber( tube( arch, 0.016, 18, 5 ), Math.round( ( x + 1 ) * 3 ) );

	}
	for ( let i = 0; i < 7; i ++ ) {

		const a = ( i + 0.5 ) / 7 * Math.PI;
		timber( box( L - 0.02, 0.014, 0.045 ), i + 1, mat4( 0, 0.05 + Math.sin( a ) * ( R - 0.005 ), Math.cos( a ) * ( R - 0.005 ), - ( a - Math.PI / 2 ) ) );

	}
	// The original has half-disc net ends. Use fine crossed strands here, rather than solid panels,
	// so the catches remain visible through the weathered green mesh.
	for ( const x of [ - L / 2 + 0.03, L / 2 - 0.03 ] ) {

		for ( const scale of [ 0.32, 0.58, 0.82 ] ) {

			const arc = [];
			for ( let i = 0; i <= 8; i ++ ) {

				const a = i / 8 * Math.PI;
				arc.push( new Vector3( x, 0.05 + Math.sin( a ) * ( R - 0.018 ) * scale, Math.cos( a ) * ( R - 0.018 ) * scale ) );

			}
			add( tube( arc, 0.006, 12, 4 ), net, 0.78, 0, PAT.plain );

		}
		for ( let i = 1; i < 7; i ++ ) {

			const a = i / 7 * Math.PI;
			add( tube( [ new Vector3( x, 0.05, 0 ), new Vector3( x, 0.05 + Math.sin( a ) * ( R - 0.018 ), Math.cos( a ) * ( R - 0.018 ) ) ], 0.005, 6, 3 ), net, 0.78, 0, PAT.plain );

		}

	}
	const handle = [ new Vector3( - 0.1, 0.05 + R, 0 ), new Vector3( - 0.05, 0.05 + R - 0.085, 0 ), new Vector3( 0.05, 0.05 + R - 0.085, 0 ), new Vector3( 0.1, 0.05 + R, 0 ) ];
	add( tube( handle, 0.01, 12, 4 ), rope, 0.75, 0, PAT.plain );
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
