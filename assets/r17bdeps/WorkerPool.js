/**
 * @author Deepkolos / https://github.com/deepkolos
 */

export class WorkerPool {

	constructor( pool = 4 ) {

		this.pool = pool;
		this.queue = [];
		this.workers = [];
		this.workersResolve = [];
		this.workersReject = [];
		this.workerStatus = 0;

	}

	_initWorker( workerId ) {

		if ( ! this.workers[ workerId ] ) {

			const worker = this.workerCreator();
			worker.addEventListener( 'message', this._onMessage.bind( this, workerId ) );
			const fail = ( what, e ) => { const msg = 'r17 worker ' + workerId + ' ' + what + ': ' + ( ( e && ( e.message || e.type ) ) || 'unknown' ) + ( e && e.filename ? ' @' + e.filename + ':' + e.lineno : '' ); console.error( msg, e ); const rj = this.workersReject && this.workersReject[ workerId ]; this.workersResolve[ workerId ] = null; if ( rj ) rj( new Error( msg ) ); this.workerStatus &= ~( 1 << workerId ); };
			worker.addEventListener( 'error', ( e ) => fail( 'error', e ) );
			worker.addEventListener( 'messageerror', ( e ) => fail( 'messageerror', e ) );
			this.workers[ workerId ] = worker;

		}

	}

	_getIdleWorker() {

		for ( let i = 0; i < this.pool; i ++ )
			if ( ! ( this.workerStatus & ( 1 << i ) ) ) return i;

		return - 1;

	}

	_onMessage( workerId, msg ) {

		const resolve = this.workersResolve[ workerId ];
		resolve && resolve( msg );

		if ( this.queue.length ) {

			const { resolve, reject, msg, transfer } = this.queue.shift();
			this.workersResolve[ workerId ] = resolve;
			this.workersReject[ workerId ] = reject;
			this.workers[ workerId ].postMessage( msg, transfer );

		} else {

			this.workerStatus ^= 1 << workerId;

		}

	}

	setWorkerCreator( workerCreator ) {

		this.workerCreator = workerCreator;

	}

	setWorkerLimit( pool ) {

		this.pool = pool;

	}

	postMessage( msg, transfer ) {

		return new Promise( ( resolve, reject ) => {

			const workerId = this._getIdleWorker();

			if ( workerId !== - 1 ) {

				this._initWorker( workerId );
				this.workerStatus |= 1 << workerId;
				this.workersResolve[ workerId ] = resolve;
				this.workersReject[ workerId ] = reject;
				this.workers[ workerId ].postMessage( msg, transfer );

			} else {

				this.queue.push( { resolve, reject, msg, transfer } );

			}

		} );

	}

	dispose() {

		this.workers.forEach( ( worker ) => worker.terminate() );
		this.workersResolve.length = 0;
		this.workers.length = 0;
		this.queue.length = 0;
		this.workerStatus = 0;

	}

}
