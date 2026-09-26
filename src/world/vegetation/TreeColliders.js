import { Vector3 } from '../../engine/index.js';
import { cylinderCollider } from '../SolidCollision.js';

const CELL = 16;

// Vegetation is densely instanced, so collision shapes are indexed by location and
// generated only for trunks near the walker. Leaves, fronds, and small plants stay
// passable; these are intentionally conservative trunk proxies rather than triangles.
export class TreeColliders {

	constructor( records ) {

		this.cells = new Map();
		for ( const kind of [ 'trees', 'palms' ] ) for ( const record of records[ kind ] || [] ) {

			const reach = kind === 'trees' ? record.s : Math.abs( record.l * record.H ) + record.s;
			const entry = { record, kind, solids: null };
			this.visitCells( record.x - reach, record.z - reach, record.x + reach, record.z + reach, key => {

				if ( ! this.cells.has( key ) ) this.cells.set( key, [] );
				this.cells.get( key ).push( entry );

			} );

		}

	}

	visitCells( x0, z0, x1, z1, visit ) {

		for ( let x = Math.floor( x0 / CELL ); x <= Math.floor( x1 / CELL ); x ++ ) {

			for ( let z = Math.floor( z0 / CELL ); z <= Math.floor( z1 / CELL ); z ++ ) visit( `${ x },${ z }` );

		}

	}

	near( previous, position, radius ) {

		const entries = new Set();
		this.visitCells( Math.min( previous.x, position.x ) - radius, Math.min( previous.z, position.z ) - radius,
			Math.max( previous.x, position.x ) + radius, Math.max( previous.z, position.z ) + radius,
			key => { for ( const entry of this.cells.get( key ) || [] ) entries.add( entry ); } );
		const solids = [];
		for ( const entry of entries ) {

			if ( ! entry.solids ) entry.solids = trunkSolids( entry.record, entry.kind );
			solids.push( ...entry.solids );

		}
		return solids;

	}

}

function trunkSolids( record, kind ) {

	const start = new Vector3( record.x, record.y, record.z );
	if ( kind === 'trees' ) {

		// The visible broadleaf trunk forks around 3.7 m in its source mesh.
		const end = new Vector3( record.x, record.y + 3.7 * record.s * record.sy, record.z );
		return [ cylinderCollider( start, end, 0.5 * record.s ) ];

	}
	// Coconut palms lean according to the same per-instance length and angle used by rendering.
	const horizontal = record.l * record.H;
	const end = new Vector3( record.x + Math.cos( record.la ) * horizontal, record.y + record.H,
		record.z + Math.sin( record.la ) * horizontal );
	return [ cylinderCollider( start, end, 0.38 * record.s ) ];

}
