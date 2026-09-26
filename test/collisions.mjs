import { Vector3 } from '../src/engine/index.js';
import { boxCollider, resolveSolidMotion } from '../src/world/SolidCollision.js';
import { Colliders } from '../src/world/Colliders.js';
import { VehicleDockCollision } from '../src/player/VehicleDockCollision.js';

let fails = 0;
const ok = ( condition, message ) => {

	if ( condition ) console.log( 'ok  ', message );
	else { fails ++; console.log( 'FAIL', message ); }

};

const wall = boxCollider( new Vector3( 0, 1, 0 ), new Vector3( 0.5, 1, 2 ) );
const run = ( from, to ) => {

	const position = to.clone();
	resolveSolidMotion( [ wall ], from, position, 0.3, 1.75, new Vector3() );
	return position;

};

let position = run( new Vector3( - 3, 0, 0 ), new Vector3( 3, 0, 0 ) );
ok( position.x <= - 0.799, 'a fast walk cannot tunnel through a wall' );

position = run( new Vector3( - 3, 0, - 1 ), new Vector3( 3, 0, 1 ) );
ok( position.x <= - 0.799 && position.z > 0.8, 'a diagonal walk slides along a blocking wall' );

const roof = boxCollider( new Vector3( 0, 2.15, 0 ), new Vector3( 2, 0.1, 2 ) );
const jump = new Vector3( 0, 2, 0 );
resolveSolidMotion( [ roof ], new Vector3( 0, 0, 0 ), jump, 0.3, 1.75, new Vector3( 0, 4, 0 ) );
ok( jump.y < 0.31, 'a jump cannot pass through a thin roof' );

const dockWorld = new Colliders();
dockWorld.addCylinder( 0, 0, 0.32, - 2, 3, { tag: 'pierPile' } );
const jetProfile = new VehicleDockCollision( { group: { name: 'JetSki' } }, dockWorld );
const jet = {
	position: new Vector3( 0, 0, 2.4 ),
	quaternion: { x: 0, y: 0, z: 0, w: 1 },
	velocity: new Vector3( 0, 0, 12 ),
	angular: new Vector3(),
};
jetProfile.resolve( jet, new Vector3( 0, 0, - 2.4 ) );
ok( jet.position.z < - 0.7 && jet.velocity.z <= 0.01, 'a fast jet ski stops and slides at a pier pile' );

const deckWorld = new Colliders();
deckWorld.addBox( new Vector3( 0, 2.25, 0 ), new Vector3( 2, 0.05, 3 ), 0, { solid: true, tag: 'pierDeck' } );
const boatProfile = new VehicleDockCollision( { group: { name: 'Boat' } }, deckWorld );
const boat = {
	position: new Vector3( 0, 0, 7 ),
	quaternion: { x: 0, y: 0, z: 0, w: 1 },
	velocity: new Vector3( 0, 0, 10 ),
	angular: new Vector3(),
};
boatProfile.resolve( boat, new Vector3( 0, 0, - 7 ) );
ok( boat.position.z < - 3.2 && boat.velocity.z <= 0.01, 'a boat cannot pass beneath the pier deck' );

if ( fails ) process.exitCode = 1;
