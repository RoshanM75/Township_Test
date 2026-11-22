import { validatePilotSnapshot } from './pilot-export.mjs';
import { PILOTS } from '../lib/pilots.ts';
/** Add a separate, immutable source dataset without replacing the Elmina graph or its audits. */
export async function seedPilotArea(pool,bundle){
    validatePilotSnapshot(bundle);
    const area=bundle.area_id;
    if(bundle.graph.edges.some(e=>e.pedestrian_access!==true||e.kind==='street'))throw Error('The pilot graph must contain pedestrian paths only.');
    const client=await pool.connect();
    try{
        await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('townshipgo-pilot-import'))");
        const existing=await client.query('SELECT count(*)::int AS count FROM path_edges WHERE area_id=$1',[area]);
        const revision=await client.query('SELECT value FROM app_metadata WHERE key=$1',[`pilot:${area}:revision`]);
        if (existing.rows[0].count && revision.rows[0]?.value !== bundle.context.dataset_id) {
            const name = area === 'pasar-seni' ? 'central KL' : PILOTS[area].short_name;
            throw Error(`Another ${name} dataset already exists. Use a separate database/version so reports and audits retain their original targets.`);
        }
        if(!existing.rows[0].count){
            const collision=await client.query('SELECT id FROM path_nodes WHERE id=ANY($1::bigint[]) AND area_id<>$2 LIMIT 1',[bundle.graph.nodes.map(n=>n.id),area]);
            if(collision.rowCount)throw Error('A source node already belongs to another area. Review dataset boundaries before importing.');
            await client.query(`INSERT INTO path_nodes(id,lat,lng,area_id) SELECT id,lat,lng,$2 FROM jsonb_to_recordset($1::jsonb) AS n(id bigint,lat float8,lng float8)`,[JSON.stringify(bundle.graph.nodes),area]);
            await client.query(`INSERT INTO path_edges(id,from_node,to_node,osm_way_id,name,source_highway,pedestrian_access,geometry,length_m,kind,surface,covered,has_steps,slope_pct,surface_rating,is_crossing,crossing_type,crossing_width_m,ped_green_s,cycle_s,has_kerb_ramp,has_refuge,shade_morning,shade_midday,shade_afternoon,shade_source,lit_ratio,lighting_source,foot_direction,area_id)
                SELECT id,from_node,to_node,osm_way_id,name,source_highway,pedestrian_access,geometry,length_m,kind,surface,covered,has_steps,slope_pct,surface_rating,is_crossing,crossing_type,crossing_width_m,ped_green_s,cycle_s,has_kerb_ramp,has_refuge,shade_morning,shade_midday,shade_afternoon,shade_source,lit_ratio,lighting_source,COALESCE(foot_direction,'both'),$2
                FROM jsonb_to_recordset($1::jsonb) AS e(id bigint,from_node bigint,to_node bigint,osm_way_id bigint,name text,source_highway text,pedestrian_access boolean,geometry jsonb,length_m float8,kind text,surface text,covered boolean,has_steps boolean,slope_pct float8,surface_rating int,is_crossing boolean,crossing_type text,crossing_width_m float8,ped_green_s float8,cycle_s float8,has_kerb_ramp boolean,has_refuge boolean,shade_morning float8,shade_midday float8,shade_afternoon float8,shade_source text,lit_ratio float8,lighting_source text,foot_direction text)`,[JSON.stringify(bundle.graph.edges),area]);
        }
        const add = existing.rows[0].count ? bundle.supplemental_assets ?? [] : bundle.walking.assets;
        for (const a of add) {
            const inserted = await client.query(`INSERT INTO walking_assets(id,external_id,parent_id,kind,category,name,lat,lng,source,source_ref,properties,edge_id,edge_fraction,connection_distance_m,area_id)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT (id) DO NOTHING`,
            [a.id,a.external_id,a.parent_id,a.kind,a.category,a.name,a.lat,a.lng,a.source,a.source_ref,JSON.stringify(a.properties),a.edge_id,a.edge_fraction,a.connection_distance_m,area]);
            if (inserted.rowCount) continue;
            const match = await client.query(`SELECT id FROM walking_assets WHERE id=$1 AND area_id=$2 AND external_id=$3
                AND parent_id IS NOT DISTINCT FROM $4::bigint AND source_ref=$5 AND edge_id IS NOT DISTINCT FROM $6::bigint`,
            [a.id,area,a.external_id,a.parent_id,a.source_ref,a.edge_id]);
            if (!match.rowCount) throw Error('A mapped access point conflicts with an existing verification target.');
        }
        for(const [key,value]of [[`pilot:${area}:revision`,bundle.context.dataset_id],[`pilot:${area}:context`,JSON.stringify(bundle.context)]])await client.query('INSERT INTO app_metadata(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value',[key,value]);
        await client.query('COMMIT');console.log(`${PILOTS[area].short_name} source data ready; ${bundle.graph.edges.length} paths.`);
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
