import { BatchTable } from '../../utilities/BatchTable.js';
import { FeatureTable } from '../../utilities/FeatureTable.js';

export interface I3DMBaseResult {

	version : string;
	featureTable: FeatureTable;
	batchTable : BatchTable;
	glbBytes : Uint8Array;

}

export class I3DMLoaderBase {

	workingPath : string;

	resolveExternalURL( url : string ) : string;
	load( url : string ) : Promise< I3DMBaseResult >;
	parse( buffer : ArrayBuffer ) : Promise< I3DMBaseResult >;

}
