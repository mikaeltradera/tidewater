import { Vector3 } from '../engine/index.js';

const MAX_TRAVEL = 0.1;

// A compact post-physics hull sweep for fixed pier geometry. It deliberately uses
// the collision world's existing boxes and cylinders rather than a second dock map.
// The response removes inward speed only, leaving the along-dock component intact.
export class VehicleDockCollision {

	constructor( model, colliders ) {

		this.colliders = colliders;
		const jetSki = model.group.name === 'JetSki';
		this.radius = jetSki ? 0.12 : 0.24;
		this.probeDrop = jetSki ? 0.5 : 0.9;
		this.probes = jetSki ? [
			[ 0, 1.35 ], [ 0.43, 0.78 ], [ - 0.43, 0.78 ], [ 0.48, - 0.72 ], [ - 0.48, - 0.72 ], [ 0, - 1.3 ],
		] : [
			[ 0, 4.1 ], [ 1.15, 2.0 ], [ - 1.15, 2.0 ], [ 1.35, - 1.0 ], [ - 1.35, - 1.0 ],
			[ 1.15, - 3.75 ], [ - 1.15, - 3.75 ], [ 0, - 3.95 ],
		];
		this.target = new Vector3();
		this.position = new Vector3();
		this.offset = new Vector3();
		this.local = new Vector3();
		this.world = new Vector3();
		this.probe = new Vector3();
		this.push = new Vector3();
		this.normal = new Vector3();
		this.deckPush = new Vector3();
		this.stats = { steps: 0, contacts: 0 };

	}

	resolve( vehicle, previousPosition ) {

		const target = this.target.copy( vehicle.position );
		const travel = previousPosition.distanceTo( target );
		if ( ! Number.isFinite( travel ) ) return;
		const candidates = this.colliders.nearbySolids( previousPosition, target, 7 );
		if ( candidates.boxes.length === 0 && candidates.cylinders.length === 0 ) return;

		const steps = Math.min( 128, Math.max( 1, Math.ceil( travel / MAX_TRAVEL ) ) );
		this.offset.set( 0, 0, 0 );
		this.stats.steps = steps;
		this.stats.contacts = 0;
		for ( let step = 1; step <= steps; step ++ ) {

			this.position.copy( previousPosition ).lerp( target, step / steps ).add( this.offset );
			vehicle.position.copy( this.position );
			for ( let iteration = 0; iteration < 3; iteration ++ ) {

				this.push.set( 0, 0, 0 );
				let hits = 0;
				for ( const [ x, z ] of this.probes ) {

					this.local.set( x, 0, z );
					this.world.copy( this.local ).applyQuaternion( vehicle.quaternion ).add( vehicle.position );
					this.probe.copy( this.world );
					this.probe.y -= this.probeDrop;
					const beforeX = this.probe.x, beforeZ = this.probe.z;
					if ( ! this.colliders.resolveCapsule( this.probe, this.radius, 1.6, 0, candidates ) ) continue;

					this.push.x += this.probe.x - beforeX;
					this.push.z += this.probe.z - beforeZ;
					hits ++;

				}
				// A hull must also stay outside the horizontal deck footprint: treating only
				// the piles lets it slip beneath the planks and become trapped. This 2D
				// envelope is intentionally limited to pier/boardwalk deck records, not every
				// raised prop in the village.
				for ( const [ x, z ] of this.probes ) {

					this.local.set( x, 0, z );
					this.world.copy( this.local ).applyQuaternion( vehicle.quaternion ).add( vehicle.position );
					if ( ! this.resolveDeckFootprint( this.world, candidates.boxes, this.deckPush ) ) continue;
					this.push.add( this.deckPush );
					hits ++;

				}
				if ( hits === 0 || this.push.lengthSq() < 1e-10 ) break;
				this.push.divideScalar( hits );
				vehicle.position.add( this.push );
				this.offset.add( this.push );
				this.normal.copy( this.push ).setY( 0 ).normalize();
				const inward = vehicle.velocity.dot( this.normal );
				if ( inward < 0 ) vehicle.velocity.addScaledVector( this.normal, - inward );
				// Glancing impacts keep their sideways component and yaw naturally, while
				// repeated contact is gently damped to prevent jitter against a piling.
				vehicle.velocity.multiplyScalar( 0.985 );
				vehicle.angular.y *= 0.88;
				this.stats.contacts ++;

			}

		}

	}

	resolveDeckFootprint( point, boxes, out ) {

		let best = null, bestDepth = Infinity;
		for ( const b of boxes ) {

			if ( ! /^(pierDeck|pierCap|pierStep|boardwalk)$/.test( b.tag ) ) continue;
			const dx = point.x - b.center.x, dz = point.z - b.center.z;
			const lx = dx * b.cos - dz * b.sin, lz = dx * b.sin + dz * b.cos;
			const ex = b.half.x + this.radius, ez = b.half.z + this.radius;
			if ( Math.abs( lx ) >= ex || Math.abs( lz ) >= ez ) continue;
			const px = ex - Math.abs( lx ), pz = ez - Math.abs( lz );
			if ( Math.min( px, pz ) >= bestDepth ) continue;
			bestDepth = Math.min( px, pz );
			if ( px < pz ) {

				const sign = Math.sign( lx ) || 1;
				best = [ sign * b.cos, - sign * b.sin, px ];

			} else {

				const sign = Math.sign( lz ) || 1;
				best = [ sign * b.sin, sign * b.cos, pz ];

			}

		}
		if ( ! best ) return false;
		out.set( best[ 0 ] * best[ 2 ], 0, best[ 1 ] * best[ 2 ] );
		return true;

	}

}
