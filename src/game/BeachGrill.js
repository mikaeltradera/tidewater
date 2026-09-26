import { BufferAttribute, BufferGeometry, Group, Mesh, Vector3 } from '../engine/index.js';
import { prepare, mergePrepared, box, cylinder, sphere, mat4 } from '../world/boat/GeoKit.js';
import { createPropMaterial, PAT } from './GameMaterials.js';
import { standard } from '../materials/Materials.js';
import { parseGLB } from '../world/debris/GLB.js';
import { loadGLB, decodeImage } from '../engine/loaders/GLTF.js';
import { Texture } from '../engine/gpu/Texture.js';
import { generateMipmaps } from '../engine/gpu/Mipmaps.js';

// A small public cookout on the quieter west side of the beach. It sits well away
// from the pier approach, Joe's queue and the roadhouse, but still faces the water.
export const BEACH_GRILL = { x: - 8, z: - 68, yaw: - 0.18 };
export const GRILL_BURN_MS = 5 * 60 * 1000;
export const COOK_READY_MS = 18 * 1000;
export const COOK_BURN_MS = 34 * 1000;

export class BeachGrill {

	constructor( { scene, terrain, colliders } ) {

		const y = terrain.heightAt( BEACH_GRILL.x, BEACH_GRILL.z );
		this.position = new Vector3( BEACH_GRILL.x, y, BEACH_GRILL.z );
		this.group = new Group();
		this.group.name = 'BeachGrillArea';
		this.group.position.copy( this.position );
		this.group.rotation.y = BEACH_GRILL.yaw;
		this.material = createPropMaterial( 'beachGrill' );
		this.group.add( new Mesh( buildGrillArea(), this.material ) );
		scene.add( this.group );
		this.fire = new Group();
		this.fire.name = 'AnimatedFire';
		this.fire.position.set( - 0.55, 0.19, 0 );
		this.fire.scale.set( 0.55, 0.61, 0.55 );
		this.fire.visible = false;
		this.group.add( this.fire );
		this.benches = new Group();
		this.benches.name = 'OldWoodenBenches';
		this.group.add( this.benches );
		this.serviceTable = new Group();
		this.serviceTable.name = 'WoodenServiceTable';
		this.group.add( this.serviceTable );
		this.fireNodes = null;
		this.fireAnimation = null;
		this.assetsReady = this.loadImportedAssets().catch( ( error ) => console.warn( 'Beach grill assets failed to load', error ) );
		this.plateDisplay = new Group();
		this.plateDisplay.name = 'GrillCounterPlates';
		this.group.add( this.plateDisplay );
		if ( colliders ) {

			const counter = local( 1.05, 0.55, 0.06 );
			colliders.addBox( new Vector3( BEACH_GRILL.x + counter.x, y + 0.55, BEACH_GRILL.z + counter.z ), new Vector3( 0.76, 0.55, 0.4 ), BEACH_GRILL.yaw, { tag: 'beachGrillCounter' } );

		}

	}

	inRange( p ) {

		return p && Math.hypot( p.x - BEACH_GRILL.x, p.z - BEACH_GRILL.z ) < 2.5;

	}

	atCounter( p ) {

		const q = local( 1.05, 0, 0.62 );
		return p && Math.hypot( p.x - ( BEACH_GRILL.x + q.x ), p.z - ( BEACH_GRILL.z + q.z ) ) < 1.45;

	}

	update( grill ) {

		const lit = grill && grill.litUntil > Date.now();
		this.fire.visible = lit;
		if ( lit ) {

			this.animateFire( Date.now() / 1000 );

		}
		this.syncPlates( grill?.plated || [] );

	}

	async loadImportedAssets() {

		const base = ( import.meta.env && import.meta.env.BASE_URL ) || '/';
		const [ benchData, tableData, fireGLTF ] = await Promise.all( [
			fetch( base + 'models/props/wooden-bench.glb' ).then( ( response ) => response.arrayBuffer() ),
			fetch( base + 'models/props/wooden-service-table.glb' ).then( ( response ) => response.arrayBuffer() ),
			loadGLB( base + 'models/props/animated-fire-yannick-deharo.glb' ),
		] );
		const fireMaterials = await fireSourceMaterials( fireGLTF );
		const benchMaterial = standard( { color: 0x6f4b30, roughness: 0.82, metalness: 0 } );
		this.fireNodes = buildAnimatedFire( fireGLTF, fireMaterials, this.fire );
		this.fireAnimation = fireGLTF.animations[ 0 ] || null;
		const bench = parseGLB( benchData );
		const table = parseGLB( tableData );
		for ( const [ x, z ] of [ [ - 0.42, - 1.23 ], [ - 0.42, 1.23 ] ] ) {

			const seat = new Group();
			seat.position.set( x, 0, z );
			seat.rotation.y = z < 0 ? 0 : Math.PI;
			// Source is authored in centimetres; keep the bench at a natural 1.4 m width.
			seat.scale.setScalar( 0.002 );
			for ( const item of bench.meshes ) {

				const mesh = new Mesh( item.geometry, benchMaterial );
				mesh.name = `WoodenBench:${ item.name }`;
				mesh.castShadow = true;
				mesh.receiveShadow = true;
				seat.add( mesh );

			}
			this.benches.add( seat );

		}

		// The source table is centered on its origin. Scaling it to a practical
		// counter height keeps the food display at the same easy-to-reach height.
		const counter = new Group();
		counter.position.set( 1.05, 0.375, 0 );
		counter.rotation.y = Math.PI / 2;
		counter.scale.setScalar( 0.255 );
		const tableMaterial = standard( { color: 0x704b31, roughness: 0.78, metalness: 0 } );
		for ( const item of table.meshes ) {

			const mesh = new Mesh( item.geometry, tableMaterial );
			mesh.name = `WoodenServiceTable:${ item.name }`;
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			counter.add( mesh );

		}
		this.serviceTable.add( counter );

	}

	// The source asset has 64 individually timed flame meshes. This samples its own
	// glTF scale channels rather than approximating them with one overall pulse.
	animateFire( seconds ) {

		const animation = this.fireAnimation;
		if ( ! animation || ! this.fireNodes ) return;
		const time = seconds % animation.duration;
		for ( const channel of animation.channels ) {

			if ( channel.path !== 'scale' ) continue;
			const node = this.fireNodes[ channel.node ];
			if ( ! node ) continue;
			const values = sampleScale( channel, time );
			node.scale.set( values[ 0 ], values[ 1 ], values[ 2 ] );

		}

	}

	syncPlates( plated ) {

		while ( this.plateDisplay.children.length > plated.length ) this.plateDisplay.remove( this.plateDisplay.children[ this.plateDisplay.children.length - 1 ] );
		while ( this.plateDisplay.children.length < plated.length ) {

			const i = this.plateDisplay.children.length;
			const plate = new Group();
			plate.add( new Mesh( cylinder( 0.19, 0.19, 0.025, 20 ), this.material ) );
			const food = new Mesh( sphere( 0.11, 12, 8 ), this.material );
			food.position.y = 0.055;
			plate.add( food );
			plate.position.set( 0.72 + ( i % 3 ) * 0.22, 0.84, - 0.16 + Math.floor( i / 3 ) * 0.2 );
			this.plateDisplay.add( plate );

		}
		plated.forEach( ( item, i ) => {

			const food = this.plateDisplay.children[ i ].children[ 1 ];
			food.material = this.material;
			food.userData.color = item.kind === 'crab' ? 0xd96c32 : 0xb97239;

		} );

	}

}

async function fireSourceMaterials( gltf ) {

	const textureCache = new Map();
	const texture = async ( index, label ) => {

		if ( index === undefined ) return null;
		if ( textureCache.has( index ) ) return textureCache.get( index );
		const image = gltf.images[ gltf.textures[ index ]?.source ];
		if ( ! image ) return null;
		const pixels = await decodeImage( image.bytes, image.mimeType );
		const out = new Texture( { label, width: pixels.width, height: pixels.height, format: 'rgba8unorm-srgb', mips: true, usage: [ 'sample', 'copyDst' ], data: pixels.data, sampler: 'anisoRepeat' } );
		out.getGPU();
		generateMipmaps( out );
		textureCache.set( index, out );
		return out;

	};
	return Promise.all( gltf.materials.map( async ( source, index ) => {

		const pbr = source.pbrMetallicRoughness || {};
		const baseFactor = pbr.baseColorFactor || [ 1, 1, 1, 1 ];
		const emissiveFactor = source.emissiveFactor || [ 0, 0, 0 ];
		const emissiveStrength = source.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1;
		const albedo = await texture( pbr.baseColorTexture?.index, `fire-${ index }-albedo` );
		const emissive = await texture( source.emissiveTexture?.index, `fire-${ index }-emissive` );
		const isFlame = source.name === 'Animation';
		return standard( {
			name: `animatedFire:${ source.name || index }`, color: 0xffffff,
			roughness: pbr.roughnessFactor ?? 0.7, metalness: pbr.metallicFactor ?? 0,
			side: source.doubleSided ? 'double' : 'front', transparent: source.alphaMode === 'BLEND', depthWrite: source.alphaMode !== 'BLEND',
			textures: { ...( albedo ? { fireAlbedo: albedo } : {} ), ...( emissive ? { fireEmissive: emissive } : {} ) },
			defines: { HAS_FIRE_ALBEDO: albedo ? 1 : 0, HAS_FIRE_EMISSIVE: emissive ? 1 : 0 },
			vertex: isFlame ? /* wgsl */`
				// The GLB's individual flame frames handle the large shape changes. This
				// small continuous displacement prevents the transition between frames from
				// reading as a static card in the real-time renderer.
				let tip = smoothstep( 0.0, 72.0, v.position.z );
				let flutter = sin( frame.time * 12.0 + v.position.z * 0.16 + v.position.x * 0.11 );
				v.position.x += flutter * tip * 3.2;
				v.position.y += sin( frame.time * 16.0 + v.position.z * 0.21 ) * tip * 1.25;
			` : '',
			surface: /* wgsl */`
let fireBase = vec3f( ${ baseFactor[ 0 ] }, ${ baseFactor[ 1 ] }, ${ baseFactor[ 2 ] } );
s.albedo *= fireBase;
s.alpha *= ${ baseFactor[ 3 ] };
#if HAS_FIRE_ALBEDO
	let sampledAlbedo = textureSample( fireAlbedo, smpAnisoRepeat, in.uv );
	s.albedo *= sampledAlbedo.rgb;
	s.alpha *= sampledAlbedo.a;
#endif
#if HAS_FIRE_EMISSIVE
	let fireGlow = textureSample( fireEmissive, smpAnisoRepeat, in.uv ).rgb;
	s.emissive = fireGlow * vec3f( ${ emissiveFactor[ 0 ] }, ${ emissiveFactor[ 1 ] }, ${ emissiveFactor[ 2 ] } ) * ${ emissiveStrength }${ isFlame ? ' * ( 0.9 + sin( frame.time * 12.0 + in.P.y * 7.0 ) * 0.1 )' : '' };
#endif`,
		} );

	} ) );

}

function buildAnimatedFire( gltf, materials, parent ) {

	const nodes = gltf.nodes.map( ( source, index ) => {

		const node = new Group();
		node.name = `AnimatedFire:${ source.name || index }`;
		node.position.fromArray( source.t );
		node.quaternion.fromArray( source.r );
		node.scale.fromArray( source.s );
		if ( source.mesh !== undefined ) for ( const primitive of gltf.meshes[ source.mesh ] ) {

			if ( ! primitive.attributes.POSITION ) continue;
			const geometry = new BufferGeometry();
			geometry.setAttribute( 'position', new BufferAttribute( asFloat( primitive.attributes.POSITION ), 3 ) );
			if ( primitive.attributes.NORMAL ) geometry.setAttribute( 'normal', new BufferAttribute( asFloat( primitive.attributes.NORMAL ), 3 ) );
			if ( primitive.attributes.TEXCOORD_0 ) geometry.setAttribute( 'uv', new BufferAttribute( asFloat( primitive.attributes.TEXCOORD_0 ), 2 ) );
			if ( primitive.indices ) geometry.setIndex( new BufferAttribute( primitive.indices, 1 ) );
			const mesh = new Mesh( geometry, materials[ primitive.material ] || materials[ 0 ] );
			mesh.castShadow = false;
			node.add( mesh );

		}
		return node;

	} );
	for ( let i = 0; i < gltf.nodes.length; i ++ ) for ( const child of gltf.nodes[ i ].children ) nodes[ i ].add( nodes[ child ] );
	for ( const root of gltf.roots ) parent.add( nodes[ root ] );
	return nodes;

}

function asFloat( attribute ) {

	if ( attribute.array instanceof Float32Array ) return attribute.array;
	const out = new Float32Array( attribute.array.length );
	const scale = attribute.normalized ? ( attribute.array instanceof Uint8Array ? 1 / 255 : attribute.array instanceof Int8Array ? 1 / 127 : attribute.array instanceof Uint16Array ? 1 / 65535 : 1 / 32767 ) : 1;
	for ( let i = 0; i < out.length; i ++ ) out[ i ] = attribute.array[ i ] * scale;
	return out;

}

function sampleScale( channel, time ) {

	const times = channel.times, values = channel.values;
	if ( time <= times[ 0 ] ) return values.subarray( 0, 3 );
	const last = times.length - 1;
	if ( time >= times[ last ] ) return values.subarray( last * 3, last * 3 + 3 );
	let i = 0;
	while ( i < last - 1 && times[ i + 1 ] <= time ) i ++;
	const t = ( time - times[ i ] ) / ( times[ i + 1 ] - times[ i ] );
	const a = i * 3, b = ( i + 1 ) * 3;
	return [ values[ a ] + ( values[ b ] - values[ a ] ) * t, values[ a + 1 ] + ( values[ b + 1 ] - values[ a + 1 ] ) * t, values[ a + 2 ] + ( values[ b + 2 ] - values[ a + 2 ] ) * t ];

}

function local( x, y, z ) {

	const c = Math.cos( BEACH_GRILL.yaw ), s = Math.sin( BEACH_GRILL.yaw );
	return new Vector3( x * c - z * s, y, x * s + z * c );

}

function buildGrillArea() {

	const p = [], add = ( g, o ) => p.push( prepare( g, o ) );
	const wood = ( color = 0x76533a ) => ( { color, rough: 0.94, pattern: PAT.woodX } );
	const metal = { color: 0x493b32, rough: 0.64, metal: 0.65, pattern: PAT.rusty };
	const log = ( x, y, z, length, angle = 0, color = 0x61402b ) => {

		// Bark, plus pale cut ends, stops the firewood from reading as plain pipes.
		add( cylinder( 0.07, 0.062, length, 10 ), { ...wood( color ), matrix: mat4( x, y, z, 0, angle, Math.PI / 2 ) } );
		const dx = Math.cos( angle ) * length * 0.5, dz = - Math.sin( angle ) * length * 0.5;
		for ( const direction of [ - 1, 1 ] ) add( cylinder( 0.052, 0.052, 0.008, 10 ), { ...wood( 0xb68a5d ), matrix: mat4( x + dx * direction, y, z + dz * direction, 0, angle, Math.PI / 2 ) } );

	};
	// Low, irregular stone hearth with an ash bed instead of a tall black plinth.
	for ( let i = 0; i < 12; i ++ ) {

		const a = i / 12 * Math.PI * 2;
		const radius = 0.37 + ( i % 3 - 1 ) * 0.018;
		add( cylinder( 0.13, 0.105, 0.29 + ( i % 2 ) * 0.035, 7 ), { color: i % 2 ? 0x62584c : 0x81715f, rough: 1, matrix: mat4( - 0.55 + Math.cos( a ) * radius, 0.075, Math.sin( a ) * radius, 0, a, Math.PI / 2 ) } );

	}
	add( cylinder( 0.29, 0.25, 0.055, 20 ), { color: 0x27221d, rough: 1, matrix: mat4( - 0.55, 0.055, 0 ) } );
	log( - 0.55, 0.135, 0, 0.47, 0.1, 0x261b16 );
	log( - 0.55, 0.195, 0, 0.43, - 0.86, 0x342019 );
	add( cylinder( 0.025, 0.02, 0.2, 8 ), { color: 0xc04d20, rough: 0.82, matrix: mat4( - 0.55, 0.12, 0, 0, 0, Math.PI / 2 ) } );
	// Simple campfire grill: legs, crossbar and five narrow cooking bars.
	for ( const x of [ - 0.78, - 0.32 ] ) add( box( 0.045, 0.55, 0.045 ), { ...metal, matrix: mat4( x, 0.45, 0 ) } );
	add( box( 0.52, 0.04, 0.045 ), { ...metal, matrix: mat4( - 0.55, 0.71, 0 ) } );
	for ( let i = 0; i < 5; i ++ ) add( box( 0.48, 0.018, 0.025 ), { ...metal, matrix: mat4( - 0.55, 0.7, - 0.18 + i * 0.09 ) } );
	// Cooler and a tidy two-layer firewood pile beside the imported serving table.
	add( box( 0.46, 0.32, 0.32 ), { color: 0x557f85, rough: 0.52, matrix: mat4( 1.7, 0.17, - 0.05 ) } );
	for ( let layer = 0; layer < 2; layer ++ ) for ( let i = 0; i < 3; i ++ ) {

		const x = - 1.48 + i * 0.15;
		log( x, 0.07 + layer * 0.13, - 0.18 + layer * 0.08, 0.62, layer ? Math.PI / 2 : 0, layer ? 0x755038 : 0x63412c );

	}
	return mergePrepared( p );

}
