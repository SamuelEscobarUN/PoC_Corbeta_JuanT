/**
 * TransformationService — orquesta la transformación de datos crudos CSV
 * al formato normalizado, delegando a la función de transformación
 * correcta según la etapa de la cascada.
 *
 * Flujo:
 *  1. Recibe uploadId, stage y rawData (registros parseados).
 *  2. Despacha al transformador correspondiente (geopos, integración, ps_ck).
 *  3. Almacena el resultado normalizado en S3 como JSON.
 *  4. Actualiza el estado del upload a `transformed` en DynamoDB.
 *  5. Retorna el TransformedData resultante.
 */

import { uploadData } from 'aws-amplify/storage';
import { generateClient } from 'aws-amplify/data';

import type { Schema } from '../../../amplify/data/resource';
import type { CascadeStage } from '../../types/csv';
import type { TransformedData } from './types';
import type {
  GeoposRawRecord,
  IntegracionRawRecord,
  PsCkRawRecord,
} from './types';
import { StoragePaths } from '../../amplify-config';
import { transformGeopos } from './geopos';
import { transformIntegracion } from './integracion';
import { transformPsCk } from './psck';

/** Cliente Amplify Data tipado con nuestro esquema. */
const client = generateClient<Schema>();

/**
 * Tipo unión de los registros crudos aceptados por el servicio.
 * El llamador debe pasar el arreglo correcto según la etapa.
 */
export type RawRecords =
  | GeoposRawRecord[]
  | IntegracionRawRecord[]
  | PsCkRawRecord[];

export class TransformationService {
  /* ------------------------------------------------------------------ */
  /*  Singleton                                                         */
  /* ------------------------------------------------------------------ */
  private static instance: TransformationService;

  private constructor() {}

  static getInstance(): TransformationService {
    if (!TransformationService.instance) {
      TransformationService.instance = new TransformationService();
    }
    return TransformationService.instance;
  }

  /* ------------------------------------------------------------------ */
  /*  API pública                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Transforma los datos crudos de un upload, almacena el resultado
   * normalizado en S3 y actualiza el estado en DynamoDB.
   *
   * @param uploadId - Identificador único del upload.
   * @param stage    - Etapa de la cascada que determina el transformador.
   * @param rawData  - Registros crudos parseados del CSV.
   * @returns Los datos transformados en formato normalizado.
   */
  async transformUpload(
    uploadId: string,
    stage: CascadeStage,
    rawData: RawRecords,
  ): Promise<TransformedData> {
    // 1. Despachar al transformador correcto según la etapa
    const transformed = this.dispatch(uploadId, stage, rawData);

    // 2. Almacenar resultado normalizado en S3
    const s3Path = StoragePaths.normalized(stage, uploadId);
    await uploadData({
      path: s3Path,
      data: JSON.stringify(transformed),
      options: { contentType: 'application/json' },
    }).result;

    // 3. Actualizar estado del upload a 'transformed' en DynamoDB
    await client.models.Upload.update({
      uploadId,
      status: 'transformed',
    });

    return transformed;
  }

  /* ------------------------------------------------------------------ */
  /*  Despacho interno                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Delega la transformación a la función correcta según la etapa.
   */
  private dispatch(
    uploadId: string,
    stage: CascadeStage,
    rawData: RawRecords,
  ): TransformedData {
    switch (stage) {
      case 'geopos_local':
      case 'geopos_central':
        return transformGeopos(
          rawData as GeoposRawRecord[],
          stage,
          uploadId,
        );

      case 'integracion':
        return transformIntegracion(
          rawData as IntegracionRawRecord[],
          uploadId,
        );

      case 'ps_ck_intfc_vtapos':
        return transformPsCk(rawData as PsCkRawRecord[], uploadId);

      default: {
        // Exhaustividad: si se agrega una etapa nueva, TypeScript lo detectará
        const _exhaustive: never = stage;
        throw new Error(`Etapa no soportada: ${_exhaustive}`);
      }
    }
  }
}

/** Instancia singleton para importaciones de conveniencia. */
export const transformationService = TransformationService.getInstance();
