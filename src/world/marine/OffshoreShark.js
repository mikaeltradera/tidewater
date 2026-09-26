import { Group, Vector3 } from '../../engine/index.js';
import { loadGLB } from '../../engine/loaders/GLTF.js';
import { SkinnedModel } from '../../engine/render/Skinning.js';
import { WORLD } from '../WorldLayout.js';

const _forward = new Vector3();
const _right = new Vector3();
const _start = new Vector3();
const _near = new Vector3();
const _end = new Vector3();

// A brief, occasional great-white sighting beyond the pier. It is deliberately independent of
// fishing gameplay: a player may glimpse it, but it never approaches the beach or the player.
export class OffshoreShark {

	constructor( { scene, terrain } ) {

		this.terrain = terrain;
		this.group = new Group();
		this.group.name = 'OffshoreGreatWhite';
		this.group.visible = false;
		scene.add( this.group );
		this.model = null;
		this.active = false;
		this.elapsed = 0;
		this.duration = 0;
		this.approachDuration = 0;
		this.cooldown = this.nextEncounterDelay();
		this.ready = this.load();

	}

	async load() {

		const base = ( import.meta.env && import.meta.env.BASE_URL ) || '/';
		const model = await SkinnedModel.create( await loadGLB( base + 'models/wildlife/great-white-shark-canyutsai.glb' ) );
		for ( const material of model.materials ) material.underwaterLighting = 'full';
		for ( const mesh of model.meshes ) {

			// The model is visible for only a few seconds and has no shadow pass. Keeping this
			// off avoids a skinned-model bind-pose bound hiding it during a sideways camera pan.
			mesh.frustumCulled = false;
			mesh.castShadow = false;
			mesh.receiveShadow = false;

		}
		this.model = model;
		// The source asset is about five metres long. A 1.5× scale makes this a striking,
		// but still plausible, adult great white while retaining its lightweight geometry.
		model.group.scale.set( 1.5, 1.5, 1.5 );
		model.play( model.clipNames()[ 0 ], { fade: 0.01, loop: true } );
		model.update( 0 );
		this.group.add( model.group );

	}

	nextEncounterDelay() {

		return 60 + Math.random() * 120;

	}

	startPass( camera ) {

		const pier = WORLD.pier;
		const minZ = pier.zEnd + 2;
		camera.getWorldDirection( _forward ).setY( 0 );
		if ( _forward.lengthSq() < 1e-5 ) _forward.set( 0, 0, 1 );
		else _forward.normalize();
		_right.set( _forward.z, 0, - _forward.x );

		// Start 25 metres out, approach directly, then make a close angled pass beside the player.
		_start.copy( camera.position ).addScaledVector( _forward, 25 );
		if ( _start.z < minZ ) _start.addScaledVector( _forward, ( minZ - _start.z ) / Math.max( _forward.z, 0.25 ) );
		for ( let attempt = 0; attempt < 12 && this.terrain.heightAt( _start.x, _start.z ) > - 2.5; attempt ++ ) {

			_start.x = pier.x + ( Math.random() - 0.5 ) * 55;
			_start.z = minZ + Math.random() * 35;

		}
		_near.copy( camera.position ).addScaledVector( _forward, 7 );
		_near.z = Math.max( _near.z, minZ );
		// At seven metres, turn 45° to the right and cross beside the player while continuing
		// out to sea. Equal forward/right travel keeps the exit on that exact angled heading.
		const exitDistance = 55 + Math.random() * 25;
		_end.copy( _near ).addScaledVector( _forward, exitDistance ).addScaledVector( _right, exitDistance );
		_end.z = Math.max( _end.z, minZ );

		this.group.position.copy( _start );
		this.group.position.y = - 1.15;
		this.setHeading( _start, _near );
		this.elapsed = 0;
		this.approachDuration = _start.distanceTo( _near ) / 15;
		this.duration = this.approachDuration + _near.distanceTo( _end ) / 18;
		this.active = true;
		this.group.visible = true;

	}

	setHeading( from, to ) {

		const dx = to.x - from.x, dz = to.z - from.z;
		// The source model faces local -X, so add half a turn to align its nose with travel.
		this.group.rotation.y = Math.atan2( - dz, dx ) + Math.PI;

	}

	update( dt, camera ) {

		if ( ! this.model ) return;
		if ( this.active ) {

			this.elapsed += dt;
			if ( this.elapsed < this.approachDuration ) {

				this.group.position.lerpVectors( _start, _near, this.elapsed / this.approachDuration );
				this.setHeading( _start, _near );

			} else {

				const escapeTime = this.duration - this.approachDuration;
				this.group.position.lerpVectors( _near, _end, Math.min( 1, ( this.elapsed - this.approachDuration ) / escapeTime ) );
				this.setHeading( _near, _end );

			}
			// Remain fully underwater. The imported clip continuously animates the tail and body
			// for a natural swimming pass rather than a breach.
			this.group.position.y = - 2.1;
			this.model.update( dt );
			if ( this.elapsed >= this.duration ) {

				this.active = false;
				this.group.visible = false;
				this.model.hold();
				this.cooldown = this.nextEncounterDelay();

			}
			return;

		}

		this.cooldown -= dt;
		// Encounters begin only at the outer pier / open ocean. This prevents shark sightings
		// from the beach, jet ski shallows, and village waterfront.
		camera.getWorldDirection( _forward ).setY( 0 );
		if ( _forward.lengthSq() > 1e-5 ) _forward.normalize();
		if ( this.cooldown <= 0 && camera.position.z >= WORLD.pier.zEnd - 10 && _forward.z > 0.25 ) this.startPass( camera );

	}

}
