import * as THREE from '../engine/index.js';
import { boxCollider, cylinderCollider, prismCollider, transformCollider } from './SolidCollision.js';

// Lightweight collision world for the character controller and boat.
// Boxes are oriented around Y only. Walkable boxes (decks, floors, stairs) act as ground.
export class Colliders {

	constructor() {

		this.revision = 0;
		this.boxes = [];
		this.cylinders = [];
		this.surfaces = [];

	}

	// center: world center, half: half extents (x, y, z) in the box's local frame, rotY: yaw (radians)
	addBox( center, half, rotY = 0, { walkable = false, solid = true, tag = '' } = {} ) {

		const b = {
			center: center.clone(), half: half.clone(), rotY,
			cos: Math.cos( rotY ), sin: Math.sin( rotY ),
			walkable, solid, tag,
			top: center.y + half.y, bottom: center.y - half.y,
			radius: Math.hypot( half.x, half.z ),
		};
		this.boxes.push( b );
		this.revision ++;
		return b;

	}

	addCylinder( x, z, radius, yMin, yMax, { tag = '' } = {} ) {

		const c = { x, z, radius, yMin, yMax, tag };
		this.cylinders.push( c );
		this.revision ++;
		return c;

	}

	// A convex roof or shutter slab. Its thickness extends below the supplied face.
	addSurface( points, thickness ) {

		const surface = prismCollider( points, thickness );
		this.surfaces.push( surface );
		this.revision ++;
		return surface;

	}

	// Gather nearby solid obstacles for the sweep solver. Existing boxes and posts are
	// cached as convex shapes on first use; their original records remain available to
	// ground queries, camera occlusion, boats, and helicopters.
	characterSolids( previous, position, radius, height, margin = 0 ) {

		const reach = previous.distanceTo( position ) + radius + margin + 0.01;
		const solids = [ ...this.surfaces, ...( this.trees?.near( previous, position, reach ) || [] ) ];
		for ( const b of this.boxes ) {

			if ( ! b.solid ) continue;
			if ( b.bottom > Math.max( previous.y, position.y ) + height + reach || b.top < Math.min( previous.y, position.y ) - reach ) continue;
			if ( Math.abs( previous.x - b.center.x ) > b.radius + reach || Math.abs( previous.z - b.center.z ) > b.radius + reach ) continue;
			if ( ! b.shape ) b.shape = transformCollider( boxCollider( new THREE.Vector3(), b.half ), b.center,
				new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), b.rotY ) );
			solids.push( b.shape );

		}
		for ( const c of this.cylinders ) {

			if ( Math.abs( previous.x - c.x ) > c.radius + reach || Math.abs( previous.z - c.z ) > c.radius + reach ) continue;
			if ( ! c.shape ) c.shape = cylinderCollider( new THREE.Vector3( c.x, c.yMin, c.z ), new THREE.Vector3( c.x, c.yMax, c.z ), c.radius );
			solids.push( c.shape );

		}
		return solids;

	}

	// Narrow the fixed-world set for moving hull probes. This avoids scanning every
	// village prop on each 120 Hz boat or jet-ski physics step.
	nearbySolids( previous, position, pad = 0 ) {

		const boxes = [], cylinders = [];
		const minX = Math.min( previous.x, position.x ) - pad, maxX = Math.max( previous.x, position.x ) + pad;
		const minZ = Math.min( previous.z, position.z ) - pad, maxZ = Math.max( previous.z, position.z ) + pad;
		for ( const b of this.boxes ) if ( b.solid && b.center.x + b.radius >= minX && b.center.x - b.radius <= maxX && b.center.z + b.radius >= minZ && b.center.z - b.radius <= maxZ ) boxes.push( b );
		for ( const c of this.cylinders ) if ( c.x + c.radius >= minX && c.x - c.radius <= maxX && c.z + c.radius >= minZ && c.z - c.radius <= maxZ ) cylinders.push( c );
		return { boxes, cylinders };

	}

	_toLocal( b, x, z ) {

		const dx = x - b.center.x, dz = z - b.center.z;
		return [ dx * b.cos - dz * b.sin, dx * b.sin + dz * b.cos ];

	}

	_toWorldDir( b, lx, lz ) {

		return [ lx * b.cos + lz * b.sin, - lx * b.sin + lz * b.cos ];

	}

	// Highest walkable surface under (x, z) not higher than maxY.
	groundHeightAt( x, z, maxY, pad = 0 ) {

		let best = - Infinity;
		for ( const b of this.boxes ) {

			if ( ! b.walkable || b.top > maxY ) continue;
			if ( Math.abs( x - b.center.x ) > b.radius + pad + 0.01 || Math.abs( z - b.center.z ) > b.radius + pad + 0.01 ) continue;
			const [ lx, lz ] = this._toLocal( b, x, z );
			if ( Math.abs( lx ) <= b.half.x + pad && Math.abs( lz ) <= b.half.z + pad ) best = Math.max( best, b.top );

		}

		return best;

	}

	// Push a vertical capsule (feet at pos.y) out of solid geometry. Returns true if collided.
	resolveCapsule( pos, radius, height, stepHeight = 0.35, candidates = null ) {

		let hit = false;
		for ( const b of candidates?.boxes || this.boxes ) {

			if ( ! b.solid ) continue;
			if ( pos.y + height < b.bottom || pos.y + stepHeight > b.top ) continue;
			if ( Math.abs( pos.x - b.center.x ) > b.radius + radius || Math.abs( pos.z - b.center.z ) > b.radius + radius ) continue;
			const [ lx, lz ] = this._toLocal( b, pos.x, pos.z );
			const cx = Math.max( - b.half.x, Math.min( b.half.x, lx ) );
			const cz = Math.max( - b.half.z, Math.min( b.half.z, lz ) );
			let dx = lx - cx, dz = lz - cz;
			const d2 = dx * dx + dz * dz;
			if ( d2 >= radius * radius ) continue;
			let nx, nz, pen;
			if ( d2 > 1e-8 ) {

				const d = Math.sqrt( d2 );
				nx = dx / d; nz = dz / d; pen = radius - d;

			} else {

				// center inside box: push out along the smallest axis
				const px = b.half.x - Math.abs( lx ), pz = b.half.z - Math.abs( lz );
				if ( px < pz ) { nx = Math.sign( lx ) || 1; nz = 0; pen = px + radius; } else { nx = 0; nz = Math.sign( lz ) || 1; pen = pz + radius; }

			}

			const [ wx, wz ] = this._toWorldDir( b, nx, nz );
			pos.x += wx * pen;
			pos.z += wz * pen;
			hit = true;

		}

		for ( const c of candidates?.cylinders || this.cylinders ) {

			if ( pos.y + height < c.yMin || pos.y + stepHeight > c.yMax ) continue;
			const dx = pos.x - c.x, dz = pos.z - c.z;
			const r = c.radius + radius;
			const d2 = dx * dx + dz * dz;
			if ( d2 >= r * r ) continue;
			const d = Math.sqrt( d2 ) || 1e-4;
			pos.x = c.x + dx / d * r;
			pos.z = c.z + dz / d * r;
			hit = true;

		}

		return hit;

	}

	// Segment/ray against boxes (XZ-plane rotated) for camera occlusion; returns distance or Infinity.
	raycast( origin, dir, maxDist ) {

		let best = maxDist;
		for ( const b of this.boxes ) {

			if ( ! b.solid ) continue;
			const ox = origin.x - b.center.x, oz = origin.z - b.center.z, oy = origin.y - b.center.y;
			const lox = ox * b.cos - oz * b.sin, loz = ox * b.sin + oz * b.cos;
			const ldx = dir.x * b.cos - dir.z * b.sin, ldz = dir.x * b.sin + dir.z * b.cos;
			let tmin = 0, tmax = best;
			const slab = ( o, d, h ) => {

				if ( Math.abs( d ) < 1e-8 ) return Math.abs( o ) <= h;
				let t1 = ( - h - o ) / d, t2 = ( h - o ) / d;
				if ( t1 > t2 ) { const t = t1; t1 = t2; t2 = t; }
				tmin = Math.max( tmin, t1 );
				tmax = Math.min( tmax, t2 );
				return tmin <= tmax;

			};

			if ( slab( lox, ldx, b.half.x ) && slab( oy, dir.y, b.half.y ) && slab( loz, ldz, b.half.z ) ) best = Math.min( best, tmin );

		}

		return best;

	}

}
