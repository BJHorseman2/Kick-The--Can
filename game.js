/*  game.js  */
const WIDTH = 800, HEIGHT = 600;

const config = {
  type: Phaser.AUTO,
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: '#0a1a0d',
  physics: { default: 'arcade' },
  scene: { preload, create, update }
};

new Phaser.Game(config);

function preload() {
  // lightweight shapes instead of art assets
  this.load.image('player', 'https://cdn.jsdelivr.net/gh/photonstorm/phaser3-examples/public/assets/sprites/circle.png');
  this.load.image('it',     'https://cdn.jsdelivr.net/gh/photonstorm/phaser3-examples/public/assets/sprites/ball.png');
  this.load.image('can',    'https://cdn.jsdelivr.net/gh/photonstorm/phaser3-examples/public/assets/sprites/coke.png');
}

let cursors, it, hiders, can, jail,
    overlay, lightMask, light,
    gameState = 'countdown', timer = 3;

function create() {
  cursors = this.input.keyboard.createCursorKeys();

  // darkness overlay and flashlight mask
  overlay = this.add.graphics();
  overlay.fillStyle(0x000000, 0.7);
  overlay.fillRect(0, 0, WIDTH, HEIGHT);
  overlay.setDepth(10);

  light = this.make.graphics({ x: 0, y: 0, add: false });
  light.fillStyle(0xffffff);
  light.fillCircle(0, 0, 150);
  lightMask = light.createGeometryMask();
  lightMask.invertAlpha = true;
  overlay.setMask(lightMask);

  // center can
  can = this.physics.add.sprite(WIDTH/2, HEIGHT/2, 'can').setScale(0.3).setImmovable(true);

  // jail rectangle (invisible; just a zone)
  jail = this.add.zone(WIDTH-150, 50, 120, 200);
  this.add.rectangle(jail.x, jail.y, jail.width, jail.height, 0xffff00, 0.25);

  // "It" (blue)
  it = this.physics.add.sprite(WIDTH/2, HEIGHT/2 + 120, 'it').setTint(0x2196f3);
  it.speed = 180;
  it.flashlightRadius = 150;

  // 3 hiders
  hiders = this.physics.add.group();
  for (let i=0;i<3;i++){
    const p = hiders.create(Phaser.Math.Between(50, WIDTH-50), Phaser.Math.Between(50, HEIGHT-50), 'player');
    p.state = 'hiding';
    p.name = 'Player ' + (i+1);
    p.label = this.add.text(p.x, p.y - 20, p.name, {font:'16px Arial',fill:'#fff'}).setOrigin(0.5);
    p.setTint(0xffeb3b);
  }

  // overlaps
  this.physics.add.overlap(it, hiders, (it, hider) => capture(this, hider));
  this.physics.add.overlap(can, hiders, (_, h) => tryJailbreak(this, h));

  // text
  this.counterText = this.add.text(10,10,'', {font:'24px Arial', fill:'#fff'});
}

function update(time, delta) {
  if (gameState === 'countdown'){
    timer -= delta/1000;
    this.counterText.setText('Hide! ' + Math.ceil(timer));
    if (timer <= 0){ gameState='play'; this.counterText.setText(''); }
    return;
  }

  handleItMovement(it, cursors, this);

  // move flashlight mask with "it"
  light.clear();
  light.fillStyle(0xffffff);
  light.fillCircle(it.x, it.y, it.flashlightRadius);

  // simple AI for hiders
  hiders.children.iterate(h=>{
    if(!h) return;
    if(h.state==='hiding'){
      Phaser.Math.RotateToObject(h, can, 0.002*delta); // slowly face can
      this.physics.velocityFromRotation(h.rotation, 60, h.body.velocity);
    } else if(h.state==='jailed'){
      h.setPosition(
        Phaser.Math.Between(jail.x - jail.width/2 + 10, jail.x + jail.width/2 - 10),
        Phaser.Math.Between(jail.y - jail.height/2 + 10, jail.y + jail.height/2 - 10)
      );
      h.body.setVelocity(0);
    }

    // update label and visibility
    if(h.label) h.label.setPosition(h.x, h.y - 20);
    const dist = Phaser.Math.Distance.Between(it.x, it.y, h.x, h.y);
    if(dist > it.flashlightRadius){
      h.alpha = 0.2;
      if(h.label) h.label.setAlpha(0);
    } else if(h.state==='jailed'){
      h.alpha = 1;
      if(h.label) h.label.setAlpha(1);
    } else {
      h.alpha = 1;
      if(h.label) h.label.setAlpha(1);
    }
  });
}

function handleItMovement(player, cursors, scene){
  player.body.setVelocity(0);
  if (cursors.left.isDown)  player.body.setVelocityX(-player.speed);
  if (cursors.right.isDown) player.body.setVelocityX(player.speed);
  if (cursors.up.isDown)    player.body.setVelocityY(-player.speed);
  if (cursors.down.isDown)  player.body.setVelocityY(player.speed);
  player.body.velocity.normalize().scale(player.speed);
}

function capture(scene, hider){
  if(hider.state!=='hiding') return;
  const dist = Phaser.Math.Distance.Between(it.x, it.y, hider.x, hider.y);
  if(dist > it.flashlightRadius) return; // must spotlight them

  hider.state='jailed';
  const msg = scene.add.text(hider.x, hider.y-30, 'Got you '+hider.name+'!',
    {font:'20px Arial', fill:'#fff'}).setOrigin(0.5);
  scene.time.delayedCall(1000, () => msg.destroy());
}

function tryJailbreak(scene, hider){
  if(hider.state!=='hiding') return;
  // kick succeeds if in contact with can for 0.1s
  hider.state='freeing';
  scene.time.delayedCall(100, ()=>{
    // release everyone
    hiders.children.iterate(h=>{
      if(h) h.state='hiding';
    });
    scene.add.text(WIDTH/2-80,40,'Jailbreak!',{font:'32px Arial',fill:'#fff'})
         .setScrollFactor(0)
         .setDepth(1)
         .setScale(1);
  });
}
