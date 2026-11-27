# Perú al Día · El Niño hoy

Piloto ciudadano con cartografía del Perú, observaciones del mar, intensidad del calentamiento y avisos oficiales por región. Las páginas y sus recursos públicos están en `public/`. La fecha de cada observación y la hora de consulta de cada fuente aparecen en la interfaz.

## Uso local

Se requiere Node.js 24. Para leer los boletines del COEN, el publicador utiliza `pdftotext` de Poppler, disponible como `poppler-utils` en Ubuntu. La interfaz se puede servir desde esta carpeta con estos comandos.

```sh
node scripts/actualizar.mjs --sin-ia
node scripts/servidor.mjs
```

La portada se abre en `http://127.0.0.1:4173`. Para ejecutar el publicador local con su clave privada y la revisión periódica de fuentes:

```sh
node --env-file=.env.local scripts/servidor.mjs --actualizar
```

## Publicación

GitHub Pages entrega únicamente la carpeta pública. GitHub Actions consulta las fuentes con la frecuencia configurada para cada conector. La ejecución depende de la disponibilidad del programador y de la entidad emisora. El archivo del panorama conserva la última lectura exitosa si un proveedor falla. Los visores que requieren consulta directa se presentan como enlaces. Los registros de agua y carreteras pueden tener causas distintas del fenómeno El Niño.

Las capas de lluvias y ríos muestran avisos oficiales vigentes, próximos y reportes con menos de 72 horas sin vigencia definida. La capa Mar combina la anomalía térmica diaria de NOAA con los tramos que Hidrografía identifica en sus avisos de oleaje. El filtro regional incluye las jurisdicciones cuyo litoral cruza esos tramos. La ficha enlaza el aviso original y distingue los niveles que SENAMHI asigna a distintos sectores de una región.

En Lluvias, la fecha que muestra cada mapa diario de SENAMHI determina cuándo corresponde el aviso a cada región. Si faltan días en la fuente, se conserva el alcance documentado del aviso. En el detalle nacional se puede abrir también el visor de lluvia de las próximas dos horas y consultar la fecha de su última observación.

En Mar, el estado de las instalaciones portuarias se consulta directamente en DICAPI. La ficha distingue puertos marítimos, fluviales y lacustres, muestra la hora de consulta y enlaza la resolución cuando la autoridad la publica. El ámbito regional comprende las instalaciones identificadas geográficamente.

El indicador de récord consulta diariamente la serie semanal de temperatura Niño 1+2 de NOAA. Muestra el máximo de la serie, su semana y la climatología de referencia. Si la fuente falla, continúa disponible la última observación verificada.

El publicador consulta también los PDF de lluvias intensas, quebradas, ríos y meteorología que reproduce el COEN. El mapa agrupa las dos publicaciones cuando el boletín identifica expresamente el número, el año y la serie de SENAMHI. Cada ficha conserva sus enlaces oficiales. Un documento con fechas de vigencia contradictorias permanece disponible para consulta y se excluye de la cobertura del mapa.

Para ríos se cotejan el índice de SENAMHI, la capa de avisos numerados de su visor PHISIS y el cuadro nacional del COEN. La cobertura de la capa muestra la hora del parte, sus avisos y los que aparecieron después. GitHub solicita actualizar el sitio cada diez minutos. La hora de la última edición aparece en Avisos, con una indicación de demora al superar media hora.

Los boletines de las 07:00, 13:00 y 19:00 de Perú se preparan en la primera ejecución disponible del turno. La IA selecciona publicaciones oficiales. El publicador contrasta el guion con la transcripción antes de guardar la narración. Si la voz no se puede verificar, la edición sigue disponible en texto. Las solicitudes a OpenAI se realizan en el publicador. El archivo de audio se genera por edición y se comparte entre visitantes.

Al seleccionar una región, la ficha explica el hecho y su significado en castellano cotidiano. El publicador extrae lugares, mediciones, fechas y niveles del documento oficial. OpenAI redacta una explicación o selecciona una de las interpretaciones revisadas para ese tipo de aviso. La ficha indica qué método se utilizó y enlaza la fuente. Las explicaciones se reutilizan mientras siga vigente la misma información. Al seleccionar una ciudad se distingue qué avisos la mencionan y cuáles corresponden a otras localidades de la región.

La publicación en la nube reserva hasta un centavo de dólar por lote regional antes de solicitarlo a la API. Estas reservas tienen un máximo de seis dólares al mes dentro del límite conjunto del piloto. Abrir la web o consultar otra región utiliza la copia pública de la explicación.

### Operación de las claves

Configurar `OPENAI_API_KEY` y `ATLAS_STATE_KEY` como secretos de Actions. La segunda clave protege el estado privado del publicador y sus reservas de consumo. Nunca colocar archivos de entorno en la carpeta pública. Un reemplazo de la clave OpenAI se realiza en la configuración de secretos, conservando el estado de las ediciones. Revisar el vencimiento de la clave y el saldo del beneficio antes de cada renovación.

Guardar el vencimiento del período de crédito confirmado en la variable de Actions `ATLAS_CREDIT_UNTIL`, con fecha y hora UTC en formato ISO, y en `.env.local` para el publicador local. Al llegar esa hora, el atlas sigue actualizando avisos y preparando boletines de texto con fuentes oficiales. La generación con OpenAI se reanuda al configurar un nuevo período confirmado. El presupuesto del publicador limita sus solicitudes. El saldo compartido con otros proyectos se consulta en la cuenta de OpenAI.

### Fuentes y archivos

- `lib/oficiales.mjs` y `lib/medios.mjs` definen los canales, sus intervalos de consulta y los formatos aceptados.
- `lib/panorama.mjs` construye el registro y conserva la procedencia, las revisiones y las fechas de los avisos.
- `lib/boletines.mjs` prepara las ediciones, verifica el audio y limita los intentos con reservas persistentes.
- `public/atlas/` contiene cartografía, cuadrícula NOAA y créditos.
