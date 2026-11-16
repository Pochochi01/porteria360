import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { registry } from '../lib/crud.js';
import './crud.js';

/** OpenAPI 3 generado a partir de los modelos: siempre coincide con lo que valida el backend. */
function buildSpec() {
  const paths = {};
  const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'integer' } };
  const err = (d) => ({ description: d, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } });
  for (const m of registry) {
    const p = (paths[`/api/${m.path}/{id}`] = {});
    const tag = m.label;
    if (m.update) {
 p.put = {
        tags: [tag], summary: `Actualizar ${m.label.toLowerCase()}`,
        description: `Roles: ${m.editRoles.join(', ')}. Solo se envían los campos a modificar.`,
        parameters: [idParam],
        requestBody: { required: true, content: { 'application/json': { schema: zodToJsonSchema(m.update, { target: 'openApi3' }) } } },
        responses: { 200: { description: 'Registro actualizado' }, 400: err('Datos inválidos'), 403: err('Permiso denegado'), 404: err('No existe'), 409: err('Conflicto') },
      };
}
    if (m.deleteRoles) {
 p.delete = {
        tags: [tag], summary: `Eliminar ${m.label.toLowerCase()} definitivamente`,
        description: `Roles: ${m.deleteRoles.join(', ')}. Hard delete. Si hay registros relacionados responde 409 con "dependencies"; ` +
          'reenviar con ?force=1 para borrarlos en cascada (salvo los marcados "block").',
        parameters: [idParam, { name: 'force', in: 'query', schema: { type: 'integer', enum: [0, 1] } }],
        responses: { 200: { description: 'Eliminado' }, 403: err('Permiso denegado'), 404: err('No existe'), 409: err('Tiene dependencias') },
      };
}
  }
  return {
    openapi: '3.0.3',
    info: { title: 'AdminCountrys API — edición y eliminación', version: '1.0.0' },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            dependencies: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, count: { type: 'integer' }, block: { type: 'boolean' } } } },
          },
        },
      },
    },
    security: [{ bearer: [] }],
    paths,
  };
}

const r = Router();
const spec = buildSpec();
r.get('/docs.json', (req, res) => res.json(spec));
r.use('/docs', swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'AdminCountrys API' }));
export default r;
