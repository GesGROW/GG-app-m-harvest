import assert from 'node:assert/strict'
import test from 'node:test'
import { crearAperturaSesionEnLinea } from '../src/application/aperturaSesionEnLinea.js'
const sesion = { id: 'sesion', campania_id: 'camp', dni_jabero: '12345678', lote_id: 'lote', variedad_id: 'v' }
function preparar({online=true,remoto=async()=>({ok:true,sesion_id:'sesion'})}={}) {
  const calls=[]
  const offline={cosecha:{iniciarSesion:async(...args)=>{calls.push(['local',...args]);return {id:'op'}},registrarLectura:()=>42},
    sincronizacion:{sincronizar:async()=>calls.push(['sincronizar'])}}
  const api=crearAperturaSesionEnLinea({offline,backend:{iniciarSesionLectura:async d=>{calls.push(['remoto',d]);return remoto(d)}},enLinea:()=>online})
  return {api,calls}
}
test('sin internet no abre ni encola la sesión; las lecturas siguen disponibles',async()=>{
  const {api,calls}=preparar({online:false})
  await assert.rejects(api.cosecha.iniciarSesion(sesion,'operador'),/internet/)
  assert.deepEqual(calls,[]);assert.equal(api.cosecha.registrarLectura(),42)
})
test('sincroniza dependencias y confirma apertura antes de habilitar lecturas, conservando UUID',async()=>{
  const {api,calls}=preparar()
  assert.deepEqual(await api.cosecha.iniciarSesion(sesion,'operador'),{id:'op'})
  assert.deepEqual(calls.map(x=>x[0]),['sincronizar','remoto','local'])
  assert.equal(calls[1][1].sesionId,calls[2][1].id)
})
test('fallos de red, permiso o confirmación no producen una sesión local activa',async()=>{
  for (const remoto of [async()=>{throw new Error('Red')},async()=>null,async()=>({ok:false,sesion_id:'sesion'}),async()=>({id:'otra'})]) {
    const {api,calls}=preparar({remoto})
    await assert.rejects(api.cosecha.iniciarSesion(sesion,'operador'))
    assert.equal(calls.some(x=>x[0]==='local'),false)
  }
})
