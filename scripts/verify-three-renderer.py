#!/usr/bin/env python3
"""Real WebGL regressions, isolated from MongoDB, agents and paid providers.

Requires Python Playwright and Chromium. Builds the production renderer + Stage
into a temporary fixture; all GLB/PLY/panorama assets are generated locally.
"""
import argparse
import base64
import copy
import functools
import io
import json
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image, ImageChops, ImageStat
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent


def make_glb():
    positions = [-1, 0, -1, 1, 0, -1, 1, 2, -1, -1, 2, -1,
                 -1, 0, 1, 1, 0, 1, 1, 2, 1, -1, 2, 1]
    indices = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4,
               3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5]
    binary = struct.pack('<24f', *positions) + struct.pack('<36H', *indices)
    document = {'asset': {'version': '2.0'}, 'scene': 0,
                'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0}],
                'meshes': [{'primitives': [{'attributes': {'POSITION': 0}, 'indices': 1, 'material': 0}]}],
                'materials': [{'pbrMetallicRoughness': {'baseColorFactor': [0.7, 0.22, 0.06, 1], 'metallicFactor': 0, 'roughnessFactor': 0.8}}],
                'buffers': [{'byteLength': len(binary)}],
                'bufferViews': [{'buffer': 0, 'byteOffset': 0, 'byteLength': 96}, {'buffer': 0, 'byteOffset': 96, 'byteLength': 72}],
                'accessors': [{'bufferView': 0, 'componentType': 5126, 'count': 8, 'type': 'VEC3', 'min': [-1, 0, -1], 'max': [1, 2, 1]},
                              {'bufferView': 1, 'componentType': 5123, 'count': 36, 'type': 'SCALAR'}]}
    header = json.dumps(document).encode()
    header += b' ' * (-len(header) % 4)
    return struct.pack('<3I', 0x46546C67, 2, 12 + 8 + len(header) + 8 + len(binary)) + struct.pack('<2I', len(header), 0x4E4F534A) + header + struct.pack('<2I', len(binary), 0x004E4942) + binary


def make_ply():
    # Gaussian PLY, deliberately asymmetric so nonuniform calibration matters.
    points = []
    for x in range(-4, 5):
        for y in range(-6, 7):
            for z in (-2, 2):
                points.append(struct.pack('<14f', x / 4, y / 3, z / 4, -2, -2, -2, 1, 0, 0, 0, 4, 1, -0.3, -0.5))
    fields = ['x', 'y', 'z', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3', 'opacity', 'f_dc_0', 'f_dc_1', 'f_dc_2']
    header = ('ply\nformat binary_little_endian 1.0\nelement vertex ' + str(len(points)) + '\n' + ''.join(f'property float {key}\n' for key in fields) + 'end_header\n').encode()
    return header + b''.join(points)


def proxy(id, position, dimensions, role='object'):
    return {'instance_id': id, 'label': id, 'role': role,
            'proxy': {'kind': 'box', 'dimensions': dimensions, 'color': '#768c9d', 'material': 'stone', 'opacity': 1},
            'transform': {'position': position, 'rotation_quaternion': [0, 0, 0, 1], 'scale': [1, 1, 1]}}


def decode(data):
    return Image.open(io.BytesIO(base64.b64decode(data.split(',')[1]))).convert('RGB')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='/tmp/pegasus-three-renderer-results')
    args = parser.parse_args()
    output = Path(args.output); output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='pegasus-three-fixture-') as temporary:
        directory = Path(temporary)
        subprocess.run(['node', 'scripts/build-three-renderer-fixture.mjs', temporary], cwd=ROOT, check=True)
        subprocess.run(['npx', 'jiti', 'scripts/build-scene-code-fixture.ts', temporary], cwd=ROOT, check=True)
        directory.joinpath('box.glb').write_bytes(make_glb())
        directory.joinpath('quality.ply').write_bytes(make_ply())
        shutil.copytree(ROOT / 'public/spatial', directory / 'spatial')
        panorama = Image.new('RGB', (512, 256))
        for y in range(256):
            for x in range(512):
                panorama.putpixel((x, y), (40 + x // 3, 30 + y // 2, 120))
        panorama.save(directory / 'panorama.png')
        requests = []

        class Handler(SimpleHTTPRequestHandler):
            def do_GET(self):
                requests.append(self.path)
                if self.path.startswith('/slow.glb'):
                    time.sleep(1.2)
                    self.path = '/box.glb'
                super().do_GET()

            def log_message(self, *_args):
                pass

        server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=temporary))
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        results = []
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True, args=['--enable-unsafe-swiftshader'])
                page = browser.new_page(viewport={'width': 1280, 'height': 720})
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.on('console', lambda event: errors.append(event.text) if event.type == 'error' else None)
                page.goto(f'http://127.0.0.1:{server.server_port}', wait_until='networkidle')
                page.wait_for_function('!!window.threeFixture')
                floor = proxy('floor', [0, 0, -0.5], [12, 10, 0.5], 'terrain')
                box = {'instance_id': 'glb-box', 'label': 'GLB box', 'role': 'object',
                       'glb_artifact': {'sha256': 'local', 'workspace_path': 'box.glb'},
                       'optional_ply_artifact': {'sha256': 'local', 'workspace_path': 'quality.ply'},
                       'normalization': {'source_up_axis': 'Y', 'scene_up_axis': 'Z', 'pivot': 'bottom_center',
                                         'glb_basis_correction': 'gltf_y_up_to_scene_z_up', 'ply_basis_correction': 'lux_ply_negative_y_up_to_scene_z_up',
                                         'bounds': {'min': [-1, 0, -1], 'max': [1, 2, 1], 'size': [2, 2, 2]}},
                       'transform': {'position': [0, 0, 0], 'rotation_quaternion': [0, 0, 0, 1], 'scale': [1, 1, 1]}}
                page.evaluate('''instances => {
                  threeFixture.mount({revisionId:'r1',assetUrl:null,format:null,upAxis:'Z',instances,
                    objectUrl:(_,quality)=>quality==='ply'?'/quality.ply':'/slow.glb'});
                  window.poll= setInterval(()=>threeFixture.sync({instances:JSON.parse(JSON.stringify(instances))}),60);
                }''', [floor, box])
                page.wait_for_function('threeFixture.runtime.isReady()', timeout=20000)
                page.evaluate('clearInterval(window.poll)')
                assert requests.count('/slow.glb') == 1, requests
                assert page.evaluate('threeFixture.runtime.renderedRevisionId()') == 'r1'
                hit = page.evaluate("threeFixture.runtime.querySurface('floor',[3,2],100,'Z')")
                assert abs(hit[2]) < 1e-8, hit
                results.append('GLB + procedural geometry; slow load survives polling; exact surface raycast')
                print(results[-1], flush=True)
                before = page.evaluate('threeFixture.runtime.currentViewpoint()')
                screenshot = decode(page.evaluate('threeFixture.capture(undefined,"r1")'))
                assert max(ImageStat.Stat(screenshot).stddev) > 8, 'capture has no scene detail'
                screenshot.save(output / 'three-mixed-scene.png')
                observation = {'position': [5, -6, 3], 'target': [0, 0, 1], 'up': [0, 0, 1], 'fov_deg': 50}
                observed = decode(page.evaluate('view=>threeFixture.capture(view,"r1")', observation))
                assert before == page.evaluate('threeFixture.runtime.currentViewpoint()'), 'capture stole user camera'
                assert ImageChops.difference(screenshot, observed).getbbox(), 'independent camera did not change capture'
                assert 'glb-box' in page.evaluate('view=>threeFixture.runtime.visibleInstanceIds(view)', observation)
                page.evaluate('threeFixture.sync({revisionId:"r2"})')
                rejection = page.evaluate('threeFixture.capture(undefined,"r1").then(()=>null,e=>e.message)')
                assert rejection and '版本' in rejection, rejection
                results.append('real PNG readback; independent observation camera; revision mismatch rejected')
                print(results[-1], flush=True)
                # Select the native GLB with a real pointer ray, then move using WASD.
                page.evaluate('view=>threeFixture.sync({cameraMode:"agent",agentViewpoint:view})', observation)
                page.evaluate('threeFixture.sync({cameraMode:"user"})')
                projected = page.evaluate('''()=>{
                  const mesh=threeFixture.runtime.scene.getObjectByName('GLB box');
                  const p=mesh.position.clone();p.z+=1;p.project(threeFixture.runtime.userCamera);
                  return {x:(p.x+1)*640,y:(1-p.y)*360};
                }''')
                page.mouse.click(projected['x'], projected['y'])
                assert page.evaluate('threeFixture.selected.at(-1)') == 'glb-box'
                page.keyboard.down('KeyW'); page.wait_for_timeout(180); page.keyboard.up('KeyW')
                assert before['position'] != page.evaluate('threeFixture.runtime.currentViewpoint().position')
                results.append('native mesh selection and keyboard navigation')
                print(results[-1], flush=True)
                page.evaluate('threeFixture.sync({environmentUrl:"/panorama.png",environmentYawDeg:35,environmentExposure:0.7,qualityMode:"ply"})')
                page.wait_for_function('!threeFixture.states.at(-1).loading', timeout=45000)
                assert page.evaluate('threeFixture.runtime.isReady()'), page.evaluate('({states:threeFixture.states,quality:threeFixture.quality})')
                assert page.evaluate('threeFixture.quality.at(-1).loadedCount') == 1
                ply_capture = decode(page.evaluate('threeFixture.capture()'))
                assert max(ImageStat.Stat(ply_capture).stddev) > 8
                ply_capture.save(output / 'three-ply-panorama.png')
                stats = page.evaluate('''()=>{
                  const runtime=threeFixture.runtime;
                  const splat=runtime.entries.get('glb-box').quality.mesh;
                  return {active:runtime.spark.activeSplats,count:splat.numSplats,bounds:splat.getBoundingBox(),visible:splat.visible,
                    matrix:splat.matrixWorld.elements,instanceCount:runtime.spark.geometry.instanceCount,
                    context:splat.context.covTransform.basis.value.elements, errors:[splat.generatorError?.message,splat.covGeneratorError?.message],
                    renderCalls:runtime.renderer.info.render.calls, uniforms:{cov:runtime.spark.uniforms.enableCovSplats.value,ext:runtime.spark.uniforms.enableExtSplats.value}};
                }''')
                page.screenshot(path=str(output / 'three-ply-live.png'))
                page.evaluate("threeFixture.runtime.entries.get('glb-box').quality.mesh.visible=false")
                without_splats = decode(page.evaluate('threeFixture.capture()'))
                difference = ImageChops.difference(ply_capture, without_splats)
                assert difference.getbbox(), f'PLY was loaded but produced no pixels: {stats}'
                page.evaluate("threeFixture.runtime.entries.get('glb-box').quality.mesh.visible=true")
                spz_url = page.evaluate('threeFixture.makeSpz()')
                page.evaluate('threeFixture.sync({qualityMode:"glb"})')
                assert page.evaluate('threeFixture.runtime.isReady()')
                results.append('Gaussian PLY + panorama in native Three scene; GLB fallback toggle')
                page.evaluate('url=>threeFixture.mount({assetUrl:url,format:"spz",upAxis:"Z",instances:[]})', spz_url)
                page.wait_for_function('!threeFixture.states.at(-1).loading', timeout=20000)
                assert page.evaluate('threeFixture.runtime.isReady()'), page.evaluate('threeFixture.states')
                spz_image = decode(page.evaluate('threeFixture.capture({position:[4,-6,3],target:[0,0,0],up:[0,0,1],fov_deg:56})'))
                assert max(ImageStat.Stat(spz_image).stddev) > 10, 'SPZ decoded but produced no visible pixels'
                spz_image.save(output / 'three-spz-world.png')
                results.append('SPZ World decode and rendered pixels')

                # The actual product Stage is mounted, including its real canvas.
                state = {'patches': [], 'claims': [], 'completions': [], 'uploads': [], 'scene_reads': []}
                instances = [floor, proxy('ObjectA', [0, 0, 0], [2, 2, 2]), proxy('ObjectB', [10, 0, 0], [2, 2, 2])]
                scene = {'scene_id': 'scene_fixture', 'title': '可编辑客厅', 'current_version': 2, 'current_revision_id': 'rev2', 'agent_viewpoint': observation}
                commands = [
                    {'command_id': 'surface', 'revision_id': 'rev2', 'kind': 'surface_query', 'observation_id': 'surface', 'viewpoint': observation,
                     'lease': {'token': 'command-lease'}, 'surface_query': {'terrain_instance_id': 'floor', 'horizontal': [0, 0], 'cast_height': 100, 'up_axis': 'Z'}},
                    {'command_id': 'capture', 'revision_id': 'rev2', 'kind': 'capture', 'observation_id': 'capture', 'viewpoint': observation, 'lease': {'token': 'command-lease'}},
                ]

                def api(route):
                    request = route.request; url = request.url
                    if '/scene-code/' in url:
                        if 'resource=bundle' in url:
                            kind = 'bad' if '/bad?' in url else 'good'
                            route.fulfill(status=200, content_type='text/javascript', body=directory.joinpath(f'code-{kind}.js').read_bytes())
                            return
                        body = {'seed': 42, 'assets': []}
                    elif url.endswith('/spatial/scenes'):
                        body = {'scenes': [scene]}
                    elif '/render-session' in url:
                        body = {'session': {'session_id': 'session', 'lease_token': 'lease'}}
                    elif url.endswith('/render-command'):
                        state['claims'].append(request.post_data_json)
                        body = {'command': commands.pop(0) if commands else None}
                    elif '/complete' in url:
                        state['completions'].append(request.post_data_json); body = {}
                    elif url.endswith('/media/upload'):
                        data = request.post_data_buffer
                        assert b'\x89PNG\r\n\x1a\n' in data, 'Stage did not upload a real PNG'
                        state['uploads'].append(len(data))
                        body = {'image': {'assetId': 'fixture-image', 'mimeType': 'image/png'}}
                    else:
                        if request.method == 'PATCH':
                            state['patches'].append(request.post_data_json)
                            if request.post_data_json['expected_version'] != scene['current_version']:
                                route.fulfill(status=409, content_type='application/json', body='{"error":"scene_changed"}')
                                return
                        else:
                            state['scene_reads'].append(time.monotonic())
                        version = 1 if 'version=1' in url else scene['current_version']
                        items = copy.deepcopy(instances)
                        if version == 1:
                            items[1]['transform']['position'][0] = -99
                        body = {'scene': scene, 'revision': {'revision_id': f'rev{version}', 'version': version,
                                'change_summary': 'fixture', 'environment': None, 'world': None, 'instances': items},
                                'history': [{'revision_id': 'rev2', 'version': 2, 'change_summary': 'current'}, {'revision_id': 'rev1', 'version': 1, 'change_summary': 'old'}]}
                    route.fulfill(status=200, content_type='application/json', body=json.dumps(body))

                page.route('**/api/**', api)
                page.evaluate('threeFixture.mountStage()')
                for _ in range(80):
                    if len(state['completions']) >= 2:
                        break
                    page.wait_for_timeout(100)
                assert len(state['completions']) == 2, state
                assert abs(state['completions'][0]['point'][2]) < 1e-8, state
                assert state['uploads'] and state['completions'][1]['asset_id'] == 'fixture-image', state
                assert not any(result.get('error') for result in state['completions']), state
                results.append('product Stage executes agent surface/capture commands and uploads real PNG')
                page.get_by_role('button', name='资产', exact=True).click()
                page.locator('#spatial-assets-panel button').filter(has_text='ObjectA').click()
                page.get_by_role('button', name='观察', exact=True).click()
                assert page.get_by_role('spinbutton').count() == 0, 'manual transform inputs remain'
                assert page.get_by_role('button', name='向右移动', exact=True).count() == 0
                assert page.get_by_role('button', name='贴合地形', exact=True).count() == 0
                page.keyboard.press('ArrowRight'); page.keyboard.press('PageUp')
                page.wait_for_timeout(700)
                assert not state['patches'], 'read-only Stage sent a mutation request'
                results.append('product Stage: no manual transforms, movement shortcuts or PATCH saves')
                page.get_by_role('button', name='资产', exact=True).click()
                page.get_by_role('tab').filter(has_text='版本').click()
                page.get_by_role('button', name='v1 old', exact=True).click()
                page.get_by_text('历史 v1', exact=True).wait_for()
                page.wait_for_timeout(350)
                claim_count = len(state['claims'])
                page.wait_for_timeout(2700)
                assert len(state['claims']) == claim_count, 'historical Stage claimed a current command'
                assert all(claim['rendered_revision_id'] in ('rev2', 'rev3') for claim in state['claims']), state['claims']
                results.append('product Stage: historical render-session isolation')
                page.screenshot(path=str(output / 'three-stage-history.png'))
                page.evaluate('threeFixture.mountCode()')
                page.wait_for_function('threeFixture.codeRef.current?.isReady()', timeout=30000)
                assert page.evaluate('threeFixture.codeRef.current.renderedRevisionId()') == 'code-rev1'
                frame = page.frame_locator('iframe[title="Three.js 代码场景"]')
                assert frame.locator('canvas').evaluate("()=>{try{return parent.document.cookie}catch(e){return 'blocked'}}") == 'blocked'
                page.evaluate('threeFixture.codeRef.current.focusObject("ObjectA")')
                page.wait_for_function('Math.abs(threeFixture.codeRef.current.currentViewpoint().target[0]+2)<.001')
                frame.locator('canvas').click(position={'x': 640, 'y': 360})
                page.wait_for_function('threeFixture.selected.at(-1)==="ObjectA"')
                before_pose = page.evaluate('threeFixture.codeRef.current.currentViewpoint().position')
                frame.locator('canvas').press('w')
                page.wait_for_function('old=>JSON.stringify(threeFixture.codeRef.current.currentViewpoint().position)!==JSON.stringify(old)', arg=before_pose)
                encoded = page.evaluate('''async()=>{const blob=await threeFixture.codeRef.current.capture(undefined,'code-rev1');const bytes=new Uint8Array(await blob.arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text)}''')
                code_image = Image.open(io.BytesIO(base64.b64decode(encoded))).convert('RGB')
                assert max(ImageStat.Stat(code_image).stddev)>10
                code_image.save(output / 'code-worker-stage.png')
                page.evaluate('threeFixture.syncCode("bad","code-rev2")')
                page.get_by_role('alert').filter(has_text='intentional-candidate-failure').wait_for(timeout=30000)
                assert page.evaluate('threeFixture.codeRef.current.renderedRevisionId()') == 'code-rev1', 'failed candidate replaced the last good program'
                page.evaluate('threeFixture.syncCode("good","code-rev3")')
                page.wait_for_function('threeFixture.codeRef.current?.renderedRevisionId()==="code-rev3"', timeout=30000)
                assert page.locator('iframe').count()==1, 'previous Worker page was not removed after replacement'
                assert frame.locator('canvas').evaluate('element=>!!element.transferControlToOffscreen')
                results.append('code Stage: sandboxed iframe + Worker canvas, navigation, real PNG, failed candidate retains old revision, atomic replacement')
                assert not errors, errors
                browser.close()
        finally:
            server.shutdown(); server.server_close()
        output.joinpath('results.json').write_text(json.dumps({'checks': results, 'provider_calls': 0}, indent=2))
        print(json.dumps({'passed': results, 'output': str(output), 'provider_calls': 0}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
