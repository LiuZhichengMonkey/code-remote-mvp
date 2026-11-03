require 'xcodeproj'

# Called from the generated runtime/player-ios project.
project = Xcodeproj::Project.open('ios/Runner.xcodeproj')
target = project.targets.find { |item| item.name == 'Runner' }
target.build_configurations.each do |config|
  config.build_settings['OTHER_LDFLAGS[sdk=iphoneos*]'] = '$(inherited) -force_load "$(PROJECT_DIR)/TorrentNative/iphoneos.a" -lresolv -framework CoreFoundation -framework Security'
  config.build_settings['OTHER_LDFLAGS[sdk=iphonesimulator*]'] = '$(inherited) -force_load "$(PROJECT_DIR)/TorrentNative/iphonesimulator.a" -lresolv -framework CoreFoundation -framework Security'
  config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '13.0'
  config.build_settings['ARCHS'] = 'arm64'
end
project.save

# ponytail: rung 4 - declare only the native modes actually used by the player.
plist_path = 'ios/Runner/Info.plist'
plist = Xcodeproj::Plist.read_from_path(plist_path)
plist['UIBackgroundModes'] = ['audio', 'processing']
plist['BGTaskSchedulerPermittedIdentifiers'] = ['$(PRODUCT_BUNDLE_IDENTIFIER).download']
Xcodeproj::Plist.write_to_path(plist, plist_path)
