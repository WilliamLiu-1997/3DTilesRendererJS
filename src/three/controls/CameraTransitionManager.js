import { Clock, EventDispatcher, MathUtils, OrthographicCamera, PerspectiveCamera, Quaternion, Vector3 } from 'three';

const _forward = new Vector3();
const _vec = new Vector3();
const _orthographicCamera = new OrthographicCamera();
const _targetOffset = new Vector3();
const _perspOffset = new Vector3();
const _orthoOffset = new Vector3();
const _quat = new Quaternion();
const _targetQuat = new Quaternion();

export class CameraTransitionManager extends EventDispatcher {

	get animating() {

		return this._alpha !== 0 && this._alpha !== 1;

	}

	get alpha() {

		// the transition alpha towards the target camera
		return this._target === 0 ? 1 - this._alpha : this._alpha;

	}

	get camera() {

		if ( this._alpha === 0 ) return this.perspectiveCamera;
		if ( this._alpha === 1 ) return this.orthographicCamera;
		return this.transitionCamera;

	}

	get mode() {

		return this._target === 0 ? 'perspective' : 'orthographic';

	}

	set mode( v ) {

		if ( v === this.mode ) {

			return;

		}

		const prevCamera = this.camera;
		if ( v === 'perspective' ) {

			this._target = 0;
			this._alpha = 0;

		} else {

			this._target = 1;
			this._alpha = 1;

		}

		this.dispatchEvent( { type: 'camera-change', camera: this.camera, prevCamera: prevCamera } );

	}

	constructor( perspectiveCamera = new PerspectiveCamera(), orthographicCamera = new OrthographicCamera() ) {

		super();

		this.perspectiveCamera = perspectiveCamera;
		this.orthographicCamera = orthographicCamera;
		this.transitionCamera = new PerspectiveCamera();

		// settings
		this.orthographicPositionalZoom = true;
		this.orthographicOffset = 50;
		this.fixedPoint = new Vector3();
		this.duration = 200;
		this.autoSync = true;
		this.easeFunction = x => x;

		this._target = 0;
		this._alpha = 0;
		this._clock = new Clock();

	}

	toggle() {

		// reset the clock for cases where we're not calling "update" every frame
		this._target = this._target === 1 ? 0 : 1;
		this._clock.getDelta();

		this.dispatchEvent( { type: 'toggle' } );

	}

	update( deltaTime = Math.min( this._clock.getDelta(), 64 / 1000 ) ) {

		// update transforms
		if ( this.autoSync ) {

			this.syncCameras();

		}

		// perform transition
		const { perspectiveCamera, orthographicCamera, transitionCamera, camera } = this;
		const delta = deltaTime * 1e3;

		if ( this._alpha !== this._target ) {

			const direction = Math.sign( this._target - this._alpha );
			const step = direction * delta / this.duration;
			this._alpha = MathUtils.clamp( this._alpha + step, 0, 1 );

			this.dispatchEvent( { type: 'change', alpha: this.alpha } );

		}

		// find the new camera
		const prevCamera = camera;
		let newCamera = null;
		if ( this._alpha === 0 ) {

			newCamera = perspectiveCamera;

		} else if ( this._alpha === 1 ) {

			newCamera = orthographicCamera;

		} else {

			newCamera = transitionCamera;
			this._updateTransitionCamera();

		}

		if ( prevCamera !== newCamera ) {

			if ( newCamera === transitionCamera ) {

				this.dispatchEvent( { type: 'transition-start' } );

			}

			this.dispatchEvent( { type: 'camera-change', camera: newCamera, prevCamera: prevCamera } );

			if ( prevCamera === transitionCamera ) {

				this.dispatchEvent( { type: 'transition-end' } );

			}

		}

	}

	syncCameras() {

		const fromCamera = this._getFromCamera();
		const { perspectiveCamera, orthographicCamera, transitionCamera, fixedPoint } = this;

		_forward.set( 0, 0, - 1 ).transformDirection( fromCamera.matrixWorld ).normalize();

		if ( fromCamera.isPerspectiveCamera ) {

			// offset the orthographic camera backwards based on user setting to avoid cases where the ortho
			// camera position will clip into terrain when once transitioned
			if ( this.orthographicPositionalZoom ) {

				orthographicCamera.position.copy( perspectiveCamera.position ).addScaledVector( _forward, - this.orthographicOffset );
				orthographicCamera.rotation.copy( perspectiveCamera.rotation );
				orthographicCamera.updateMatrixWorld();

			} else {

				const orthoDist = _vec.subVectors( fixedPoint, orthographicCamera.position ).dot( _forward );
				const perspDist = _vec.subVectors( fixedPoint, perspectiveCamera.position ).dot( _forward );

				_vec.copy( perspectiveCamera.position ).addScaledVector( _forward, perspDist );
				orthographicCamera.rotation.copy( perspectiveCamera.rotation );
				orthographicCamera.position.copy( _vec ).addScaledVector( _forward, - orthoDist );
				orthographicCamera.updateMatrixWorld();

			}

			// calculate the necessary orthographic zoom based on the current perspective camera position
			const distToPoint = Math.abs( _vec.subVectors( perspectiveCamera.position, fixedPoint ).dot( _forward ) );
			const projectionHeight = 2 * Math.tan( MathUtils.DEG2RAD * perspectiveCamera.fov * 0.5 ) * distToPoint;
			const orthoHeight = orthographicCamera.top - orthographicCamera.bottom;
			orthographicCamera.zoom = orthoHeight / projectionHeight;
			orthographicCamera.updateProjectionMatrix();

		} else {

			// calculate the target distance from the point
			const distToPoint = Math.abs( _vec.subVectors( orthographicCamera.position, fixedPoint ).dot( _forward ) );
			const orthoHeight = ( orthographicCamera.top - orthographicCamera.bottom ) / orthographicCamera.zoom;
			const targetDist = orthoHeight * 0.5 / Math.tan( MathUtils.DEG2RAD * perspectiveCamera.fov * 0.5 );

			// set the final camera position so the pivot point is stable
			perspectiveCamera.rotation.copy( orthographicCamera.rotation );
			perspectiveCamera.position.copy( orthographicCamera.position )
				.addScaledVector( _forward, distToPoint )
				.addScaledVector( _forward, - targetDist );

			perspectiveCamera.updateMatrixWorld();

			// shift the orthographic camera position so it aligns with the perspective cameras position as
			// calculated by the FoV. This ensures a consistent orthographic position on transition.
			if ( this.orthographicPositionalZoom ) {

				orthographicCamera.position.copy( perspectiveCamera.position ).addScaledVector( _forward, - this.orthographicOffset );
				orthographicCamera.updateMatrixWorld();

			}

		}

		transitionCamera.position.copy( perspectiveCamera.position );
		transitionCamera.rotation.copy( perspectiveCamera.rotation );

	}

	_getTransitionDirection() {

		return Math.sign( this._target - this._alpha );

	}

	_getToCamera() {

		const dir = this._getTransitionDirection();
		if ( dir === 0 ) {

			return this._target === 0 ? this.perspectiveCamera : this.orthographicCamera;

		} else if ( dir > 0 ) {

			return this.orthographicCamera;

		} else {

			return this.perspectiveCamera;

		}

	}

	_getFromCamera() {

		const dir = this._getTransitionDirection();
		if ( dir === 0 ) {

			return this._target === 0 ? this.perspectiveCamera : this.orthographicCamera;

		} else if ( dir > 0 ) {

			return this.perspectiveCamera;

		} else {

			return this.orthographicCamera;

		}

	}

	_updateTransitionCamera() {

		// Perform transition interpolation between the orthographic and perspective camera
		// alpha === 0 : perspective
		// alpha === 1 : orthographic

		const { perspectiveCamera, orthographicCamera, transitionCamera, fixedPoint } = this;
		const alpha = this.easeFunction( this._alpha );

		// get the forward vector
		_forward.set( 0, 0, - 1 ).transformDirection( orthographicCamera.matrixWorld ).normalize();

		_orthographicCamera.copy( orthographicCamera );
		_orthographicCamera.position.addScaledVector( _forward, orthographicCamera.near );
		orthographicCamera.far -= orthographicCamera.near;
		orthographicCamera.near = 0;

		// compute the projection height based on the perspective camera
		_forward.set( 0, 0, - 1 ).transformDirection( perspectiveCamera.matrixWorld ).normalize();
		const distToPoint = Math.abs( _vec.subVectors( perspectiveCamera.position, fixedPoint ).dot( _forward ) );
		const projectionHeight = 2 * Math.tan( MathUtils.DEG2RAD * perspectiveCamera.fov * 0.5 ) * distToPoint;

		// calculate the orientation to transition to
		const targetQuat = _targetQuat.slerpQuaternions( perspectiveCamera.quaternion, _orthographicCamera.quaternion, alpha );

		// calculate the target distance and fov to position the camera at
		const targetFov = MathUtils.lerp( perspectiveCamera.fov, 1, alpha );
		const targetDistance = projectionHeight * 0.5 / Math.tan( MathUtils.DEG2RAD * targetFov * 0.5 );

		// calculate the offset from the fixed point
		const orthoOffset = _orthoOffset.copy( _orthographicCamera.position ).sub( fixedPoint ).applyQuaternion( _quat.copy( _orthographicCamera.quaternion ).invert() );
		const perspOffset = _perspOffset.copy( perspectiveCamera.position ).sub( fixedPoint ).applyQuaternion( _quat.copy( perspectiveCamera.quaternion ).invert() );
		const targetOffset = _targetOffset.lerpVectors( perspOffset, orthoOffset, alpha );
		targetOffset.z -= Math.abs( targetOffset.z ) - targetDistance;

		// calculate distances to the target point so the offset can be accounted for in near plane calculations
		const distToPersp = - ( perspOffset.z - targetOffset.z );
		const distToOrtho = - ( orthoOffset.z - targetOffset.z );

		// calculate the near and far plane positions
		const targetNearPlane = MathUtils.lerp( distToPersp + perspectiveCamera.near, distToOrtho + _orthographicCamera.near, alpha );
		const targetFarPlane = MathUtils.lerp( distToPersp + perspectiveCamera.far, distToOrtho + _orthographicCamera.far, alpha );
		const planeDelta = Math.max( targetFarPlane, 0 ) - Math.max( targetNearPlane, 0 );

		// NOTE: The "planeDelta * 1e-5" can wind up being larger than either of the camera near planes, resulting
		// in some clipping during the transition phase.

		// update the camera state
		transitionCamera.aspect = perspectiveCamera.aspect;
		transitionCamera.fov = targetFov;
		transitionCamera.near = Math.max( targetNearPlane, planeDelta * 1e-5 );
		transitionCamera.far = targetFarPlane;
		transitionCamera.position.copy( targetOffset ).applyQuaternion( targetQuat ).add( fixedPoint );
		transitionCamera.quaternion.copy( targetQuat );
		transitionCamera.updateProjectionMatrix();
		transitionCamera.updateMatrixWorld();

	}

}
